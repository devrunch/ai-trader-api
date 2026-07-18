import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import axios from 'axios';

import {
  PaperPortfolio,
  PaperPortfolioDocument,
  Exchange,
} from './schemas/paper-portfolio.schema';
import {
  PaperPosition,
  PaperPositionDocument,
} from './schemas/paper-position.schema';
import {
  PaperOrder,
  PaperOrderDocument,
  OrderSide,
  OrderType,
  OrderStatus,
} from './schemas/paper-order.schema';
import {
  PaperTrade,
  PaperTradeDocument,
} from './schemas/paper-trade.schema';

import { CreatePortfolioDto } from './dto/create-portfolio.dto';
import { PlaceOrderDto } from './dto/place-order.dto';

@Injectable()
export class PaperTradingService {
  private readonly signalsUrl: string;

  constructor(
    @InjectModel(PaperPortfolio.name)
    private readonly portfolioModel: Model<PaperPortfolioDocument>,
    @InjectModel(PaperPosition.name)
    private readonly positionModel: Model<PaperPositionDocument>,
    @InjectModel(PaperOrder.name)
    private readonly orderModel: Model<PaperOrderDocument>,
    @InjectModel(PaperTrade.name)
    private readonly tradeModel: Model<PaperTradeDocument>,
    private readonly config: ConfigService,
  ) {
    this.signalsUrl =
      this.config.get<string>('SIGNALS_SERVICE_URL') ??
      'http://localhost:8001';
  }

  // ------------------------------------------------------------------
  // Portfolio lifecycle
  // ------------------------------------------------------------------

  async createPortfolio(userId: string, dto: CreatePortfolioDto) {
    const initial = dto.initialCapital ?? 100000;
    const portfolio = await this.portfolioModel.create({
      userId,
      exchange: dto.exchange,
      initialCapital: initial,
      cashBalance: initial,
    });
    return portfolio;
  }

  async getPortfolio(userId: string, exchange: Exchange): Promise<any> {
    const portfolio = await this.portfolioModel
      .findOne({ userId, exchange })
      .lean();
    if (!portfolio) throw new NotFoundException('Portfolio not found');

    const positions = await this.positionModel
      .find({ portfolioId: portfolio._id })
      .lean();

    const totalValue =
      portfolio.cashBalance +
      positions.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);

    const unrealisedPnl = positions.reduce(
      (sum, p) => sum + p.unrealisedPnl,
      0,
    );

    return {
      ...portfolio,
      positions,
      totalValue,
      unrealisedPnl,
      totalPnl: portfolio.realisedPnl + unrealisedPnl,
    };
  }

  async listPortfolios(userId: string) {
    return this.portfolioModel.find({ userId }).lean();
  }

  // ------------------------------------------------------------------
  // Order placement + immediate MARKET execution
  // ------------------------------------------------------------------

  async placeOrder(userId: string, dto: PlaceOrderDto) {
    const exchange = dto.exchange.toUpperCase() as Exchange;
    const portfolio = await this.portfolioModel.findOne({ userId, exchange });
    if (!portfolio) {
      throw new NotFoundException(
        `No paper portfolio found for ${exchange}. Create one first.`,
      );
    }

    const order = await this.orderModel.create({
      portfolioId: portfolio._id,
      userId,
      symbol: dto.symbol.toUpperCase(),
      exchange,
      side: dto.side,
      type: dto.type ?? OrderType.MARKET,
      quantity: dto.quantity,
      limitPrice: dto.limitPrice,
      status: OrderStatus.PENDING,
    });

    // Market orders execute immediately
    if (order.type === OrderType.MARKET) {
      return this.executeOrder(order._id.toString(), portfolio);
    }

    return order;
  }

  // ------------------------------------------------------------------
  // Order execution — fetches live price, updates position & cash
  // ------------------------------------------------------------------

  async executeOrder(
    orderId: string,
    portfolio?: PaperPortfolioDocument,
  ) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order is not in PENDING state');
    }

    if (!portfolio) {
      portfolio = (await this.portfolioModel.findById(
        order.portfolioId,
      )) as PaperPortfolioDocument;
    }

    // Fetch live price from Python signals service
    const ltp = await this.fetchLtp(order.symbol, order.exchange);

    const executedPrice =
      order.type === OrderType.LIMIT && order.limitPrice
        ? order.limitPrice
        : ltp;

    const totalCost = executedPrice * order.quantity;

    if (order.side === OrderSide.BUY) {
      if (portfolio.cashBalance < totalCost) {
        order.status = OrderStatus.REJECTED;
        order.rejectionReason = 'Insufficient cash balance';
        await order.save();
        throw new BadRequestException(
          `Insufficient balance. Required ₹${totalCost.toFixed(2)}, available ₹${portfolio.cashBalance.toFixed(2)}`,
        );
      }

      portfolio.cashBalance -= totalCost;
      await this.upsertPosition(order, executedPrice, portfolio);
    } else {
      // SELL
      const position = await this.positionModel.findOne({
        portfolioId: portfolio._id,
        symbol: order.symbol,
      });

      if (!position || position.quantity < order.quantity) {
        order.status = OrderStatus.REJECTED;
        order.rejectionReason = 'Insufficient position quantity';
        await order.save();
        throw new BadRequestException(
          `Cannot sell ${order.quantity} — only ${position?.quantity ?? 0} held`,
        );
      }

      const realisedPnl =
        (executedPrice - position.averageCost) * order.quantity;
      portfolio.cashBalance += totalCost;
      portfolio.realisedPnl += realisedPnl;

      await this.reducePosition(order, executedPrice, position, realisedPnl);
    }

    await portfolio.save();

    order.status = OrderStatus.EXECUTED;
    order.executedPrice = executedPrice;
    order.executedAt = new Date();
    await order.save();

    const trade = await this.tradeModel.create({
      portfolioId: order.portfolioId,
      orderId: order._id,
      userId: order.userId,
      symbol: order.symbol,
      exchange: order.exchange,
      side: order.side,
      quantity: order.quantity,
      price: executedPrice,
      realisedPnl:
        order.side === OrderSide.SELL
          ? (executedPrice -
              ((
                await this.positionModel.findOne({
                  portfolioId: portfolio._id,
                  symbol: order.symbol,
                })
              )?.averageCost ?? executedPrice)) *
            order.quantity
          : 0,
      executedAt: order.executedAt,
    });

    return { order, trade };
  }

  // ------------------------------------------------------------------
  // Position helpers
  // ------------------------------------------------------------------

  private async upsertPosition(
    order: PaperOrderDocument,
    executedPrice: number,
    portfolio: PaperPortfolioDocument,
  ) {
    const existing = await this.positionModel.findOne({
      portfolioId: portfolio._id,
      symbol: order.symbol,
    });

    if (existing) {
      const totalQty = existing.quantity + order.quantity;
      const totalCost =
        existing.averageCost * existing.quantity +
        executedPrice * order.quantity;
      existing.averageCost = totalCost / totalQty;
      existing.quantity = totalQty;
      existing.currentPrice = executedPrice;
      existing.unrealisedPnl =
        (executedPrice - existing.averageCost) * totalQty;
      await existing.save();
    } else {
      await this.positionModel.create({
        portfolioId: portfolio._id,
        userId: order.userId,
        symbol: order.symbol,
        exchange: order.exchange,
        quantity: order.quantity,
        averageCost: executedPrice,
        currentPrice: executedPrice,
        unrealisedPnl: 0,
      });
    }
  }

  private async reducePosition(
    order: PaperOrderDocument,
    executedPrice: number,
    position: PaperPositionDocument,
    realisedPnl: number,
  ) {
    position.quantity -= order.quantity;
    if (position.quantity === 0) {
      await position.deleteOne();
    } else {
      position.currentPrice = executedPrice;
      position.unrealisedPnl =
        (executedPrice - position.averageCost) * position.quantity;
      await position.save();
    }
  }

  // ------------------------------------------------------------------
  // Price fetch from Python signals service
  // ------------------------------------------------------------------

  private async fetchLtp(symbol: string, exchange: string): Promise<number> {
    try {
      const res = await axios.get(
        `${this.signalsUrl}/market/quote/${symbol}`,
        { params: { exchange }, timeout: 5000 },
      );
      const ltp = res.data?.ltp;
      if (!ltp) throw new Error('Empty LTP');
      return ltp;
    } catch (e) {
      throw new BadRequestException(
        `Could not fetch live price for ${symbol}/${exchange}: ${(e as Error).message}`,
      );
    }
  }

  // ------------------------------------------------------------------
  // Query helpers
  // ------------------------------------------------------------------

  async getOrders(userId: string, limit = 50) {
    return this.orderModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async getTrades(userId: string, limit = 100) {
    return this.tradeModel
      .find({ userId })
      .sort({ executedAt: -1 })
      .limit(limit)
      .lean();
  }

  async getPositions(userId: string) {
    return this.positionModel.find({ userId }).lean();
  }

  async refreshPositionPrices(userId: string) {
    const positions = await this.positionModel.find({ userId });
    for (const pos of positions) {
      try {
        const ltp = await this.fetchLtp(pos.symbol, pos.exchange);
        pos.currentPrice = ltp;
        pos.unrealisedPnl = (ltp - pos.averageCost) * pos.quantity;
        await pos.save();
      } catch {
        // non-fatal — keep stale price
      }
    }
    return this.positionModel.find({ userId }).lean();
  }
}
