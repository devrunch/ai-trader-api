import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { SignalsGateway } from '../signals/signals.gateway';
import { PortfolioAccountsService } from './portfolio-accounts.service';
import { PaperPortfolio, PaperPortfolioDocument } from './schemas/paper-portfolio.schema';
import { PaperPosition, PaperPositionDocument } from './schemas/paper-position.schema';
import {
  OrderSide,
  OrderStatus,
  OrderType,
  PaperOrder,
  PaperOrderDocument,
} from './schemas/paper-order.schema';
import { PaperTrade, PaperTradeDocument } from './schemas/paper-trade.schema';

/**
 * Where money actually moves.
 *
 * The smallest and most dangerous file in the portfolio module, on purpose:
 * everything that only *reads* an account lives in
 * `portfolio-accounts.service.ts`, and everything that decides whether an order
 * is allowed lives in `risk-limits.service.ts`. What is left here is the
 * sequence that debits cash, opens or reduces a position, and books a trade —
 * and the compensation that unwinds it when a later step fails.
 *
 * There is no multi-document transaction (a standalone Mongo has no replica
 * set), so the ordering below is the correctness argument and should be changed
 * only with that in mind.
 */
@Injectable()
export class OrderExecutionService {
  private readonly logger = new Logger(OrderExecutionService.name);

  constructor(
    @InjectModel(PaperPortfolio.name)
    private readonly portfolioModel: Model<PaperPortfolioDocument>,
    @InjectModel(PaperPosition.name)
    private readonly positionModel: Model<PaperPositionDocument>,
    @InjectModel(PaperOrder.name)
    private readonly orderModel: Model<PaperOrderDocument>,
    @InjectModel(PaperTrade.name)
    private readonly tradeModel: Model<PaperTradeDocument>,
    private readonly accounts: PortfolioAccountsService,
    private readonly gateway: SignalsGateway,
  ) {}

  async executeOrder(
    orderId: string,
    portfolio?: PaperPortfolioDocument,
    requestingUserId?: string,
  ) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    // Ownership check — callers that pass a user id may only touch their own orders.
    if (requestingUserId && order.userId !== requestingUserId) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order is not in PENDING state');
    }

    let pf = portfolio ?? (await this.portfolioModel.findById(order.portfolioId));
    if (!pf) throw new NotFoundException('Portfolio not found');

    // Fetch live price from Python signals service
    const ltp = await this.accounts.fetchLtp(order.symbol, order.exchange);

    // A LIMIT order may only fill when the market actually reaches it, and it
    // fills at the prevailing price — not at whatever limit was requested.
    // Filling at the limit unconditionally allowed "BUY @ ₹1" / "SELL @ ₹100000"
    // to execute, which made the paper account arbitrarily inflatable and
    // corrupted every downstream figure that sizes off account value.
    if (order.type === OrderType.LIMIT && order.limitPrice) {
      const reachable =
        order.side === OrderSide.BUY ? ltp <= order.limitPrice : ltp >= order.limitPrice;
      if (!reachable) {
        throw new BadRequestException(
          `Limit not reached: ${order.symbol} is at ₹${ltp}, limit is ₹${order.limitPrice}`,
        );
      }
    }
    const executedPrice = ltp;

    const totalCost = executedPrice * order.quantity;
    let sellAvgCost = 0; // captured before position is potentially deleted
    let realisedPnl = 0;
    let sellPosition: PaperPositionDocument | null = null;

    if (order.side === OrderSide.BUY) {
      // Single conditional atomic update. The old read-check-mutate-save let two
      // concurrent orders both read cashBalance = 10000, both pass the check for
      // a ₹9,000 order and both write — trivially reachable from a double-clicked
      // buy button. The $gte guard and the $inc are one Mongo operation, so
      // exactly one of two racing orders can win.
      const debited = await this.portfolioModel.findOneAndUpdate(
        { _id: pf._id, cashBalance: { $gte: totalCost } },
        { $inc: { cashBalance: -totalCost } },
        { new: true },
      );

      if (!debited) {
        const current = await this.portfolioModel.findById(pf._id).lean();
        order.status = OrderStatus.REJECTED;
        order.rejectionReason = 'Insufficient cash balance';
        await order.save();
        throw new BadRequestException(
          `Insufficient balance. Required ₹${totalCost.toFixed(2)}, available ₹${(current?.cashBalance ?? 0).toFixed(2)}`,
        );
      }
      pf = debited;
    } else {
      // SELL
      const position = await this.positionModel.findOne({
        portfolioId: pf._id,
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

      sellPosition = position;
      sellAvgCost = position.averageCost;
      realisedPnl = (executedPrice - sellAvgCost) * order.quantity;

      const credited = await this.portfolioModel.findOneAndUpdate(
        { _id: pf._id },
        { $inc: { cashBalance: totalCost, realisedPnl } },
        { new: true },
      );
      if (!credited) throw new NotFoundException('Portfolio not found');
      pf = credited;
    }

    // The cash movement is now committed. There is no multi-document
    // transaction here (a standalone Mongo has no replica set), so each later
    // step explicitly reverses the $inc on failure, and the order is marked
    // EXECUTED *last* — that status is the commit point, so a crash mid-sequence
    // leaves a still-PENDING order with its cash restored, which is replayable.
    const executedAt = new Date();
    let trade: PaperTradeDocument;

    try {
      if (order.side === OrderSide.BUY) {
        await this.upsertPosition(order, executedPrice, pf);
      } else {
        await this.reducePosition(order, executedPrice, sellPosition!);
      }

      const tradeRealisedPnl =
        order.side === OrderSide.SELL ? (executedPrice - sellAvgCost) * order.quantity : 0;

      trade = await this.tradeModel.create({
        portfolioId: order.portfolioId,
        orderId: order._id,
        userId: order.userId,
        symbol: order.symbol,
        exchange: order.exchange,
        side: order.side,
        quantity: order.quantity,
        price: executedPrice,
        realisedPnl: tradeRealisedPnl,
        executedAt,
      });
    } catch (err) {
      await this.compensateCash(pf, order.side, totalCost, realisedPnl, order._id);
      throw err;
    }

    order.status = OrderStatus.EXECUTED;
    order.executedPrice = executedPrice;
    order.executedAt = executedAt;
    await order.save();

    // Push the updated order and position set to the user's authenticated room.
    this.gateway.emitOrderUpdate(order.userId, order.toObject());
    const positions = await this.positionModel.find({ userId: order.userId }).lean();
    this.gateway.emitPositionUpdate(order.userId, positions);

    return { order, trade };
  }

  /** Reverse an already-applied cash movement after a later step failed. */
  private async compensateCash(
    portfolio: PaperPortfolioDocument,
    side: OrderSide,
    totalCost: number,
    realisedPnl: number,
    orderId: unknown,
  ) {
    try {
      await this.portfolioModel.updateOne(
        { _id: portfolio._id },
        {
          $inc: {
            cashBalance: side === OrderSide.BUY ? totalCost : -totalCost,
            realisedPnl: -realisedPnl,
          },
        },
      );
    } catch (e) {
      // Nothing else can be done automatically — surface it loudly so the
      // drift is visible rather than silently corrupting the account.
      this.logger.error(
        `Cash compensation FAILED for order ${String(orderId)} — portfolio ${String(portfolio._id)} may be inconsistent`,
        e as Error,
      );
    }
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
        existing.averageCost * existing.quantity + executedPrice * order.quantity;
      existing.averageCost = totalCost / totalQty;
      existing.quantity = totalQty;
      existing.currentPrice = executedPrice;
      existing.unrealisedPnl = (executedPrice - existing.averageCost) * totalQty;
      // A later order may declare a stop where the first did not; take the
      // newest declaration, since it is the one the user last stated.
      if (order.stopLoss !== undefined) existing.stopLoss = order.stopLoss;
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
        stopLoss: order.stopLoss,
      });
    }
  }

  private async reducePosition(
    order: PaperOrderDocument,
    executedPrice: number,
    position: PaperPositionDocument,
  ) {
    position.quantity -= order.quantity;
    if (position.quantity === 0) {
      await position.deleteOne();
    } else {
      position.currentPrice = executedPrice;
      position.unrealisedPnl = (executedPrice - position.averageCost) * position.quantity;
      await position.save();
    }
  }
}
