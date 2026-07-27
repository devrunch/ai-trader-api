import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { MarketService } from '../market/market.service';
import { SignalsGateway } from '../signals/signals.gateway';
import { CreatePortfolioDto } from './dto/create-portfolio.dto';
import {
  Exchange,
  PaperPortfolio,
  PaperPortfolioDocument,
} from './schemas/paper-portfolio.schema';
import { PaperOrder, PaperOrderDocument } from './schemas/paper-order.schema';
import { PaperPosition, PaperPositionDocument } from './schemas/paper-position.schema';
import { PaperTrade, PaperTradeDocument } from './schemas/paper-trade.schema';
import {
  MARK_STALE_AFTER_MS,
  PortfolioView,
  RefreshPricesResult,
} from './paper-trading.types';

/**
 * The account, and everything that reads it.
 *
 * Split from order execution because the two fail differently: nothing here
 * moves money, so a bug in this file shows a wrong number, while a bug in
 * execution *is* a wrong number. Keeping them apart means the file that matters
 * most is the smallest one.
 */
@Injectable()
export class PortfolioAccountsService {
  private readonly logger = new Logger(PortfolioAccountsService.name);

  private static readonly DEFAULT_CAPITAL = 100000;

  constructor(
    @InjectModel(PaperPortfolio.name)
    private readonly portfolioModel: Model<PaperPortfolioDocument>,
    @InjectModel(PaperPosition.name)
    private readonly positionModel: Model<PaperPositionDocument>,
    @InjectModel(PaperOrder.name)
    private readonly orderModel: Model<PaperOrderDocument>,
    @InjectModel(PaperTrade.name)
    private readonly tradeModel: Model<PaperTradeDocument>,
    private readonly market: MarketService,
    private readonly gateway: SignalsGateway,
  ) {}

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  async createPortfolio(userId: string, dto: CreatePortfolioDto) {
    return this.ensurePortfolio(userId, (dto.exchange ?? 'NSE') as Exchange, dto.initialCapital);
  }

  /** Every user always has a paper portfolio per exchange — create on first touch. */
  async ensurePortfolio(
    userId: string,
    exchange: Exchange,
    initialCapital?: number,
  ): Promise<PaperPortfolioDocument> {
    const existing = await this.portfolioModel.findOne({ userId, exchange });
    if (existing) return existing;
    const initial = initialCapital ?? PortfolioAccountsService.DEFAULT_CAPITAL;
    return this.portfolioModel.create({
      userId, exchange, initialCapital: initial, cashBalance: initial,
    });
  }

  /** Wipe positions/orders/trades and restore starting cash. */
  async resetPortfolio(userId: string, exchange: Exchange = Exchange.NSE) {
    const portfolio = await this.ensurePortfolio(userId, exchange);
    await Promise.all([
      this.positionModel.deleteMany({ portfolioId: portfolio._id }),
      this.orderModel.deleteMany({ userId, exchange }),
      this.tradeModel.deleteMany({ userId, exchange }),
    ]);
    portfolio.cashBalance = portfolio.initialCapital;
    portfolio.realisedPnl = 0;
    portfolio.totalPositionValue = 0;
    await portfolio.save();
    this.gateway.emitPositionUpdate(userId, []);
    return { ok: true, cashBalance: portfolio.cashBalance };
  }

  // ------------------------------------------------------------------
  // The read model
  // ------------------------------------------------------------------

  async getPortfolio(userId: string, exchange: Exchange): Promise<PortfolioView> {
    await this.ensurePortfolio(userId, exchange);
    const portfolio = await this.portfolioModel.findOne({ userId, exchange }).lean();
    if (!portfolio) throw new NotFoundException('Portfolio not found');

    const positions = await this.positionModel.find({ portfolioId: portfolio._id }).lean();

    const totalValue =
      portfolio.cashBalance +
      positions.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);

    const unrealisedPnl = positions.reduce((sum, p) => sum + p.unrealisedPnl, 0);

    // Age of the OLDEST mark, not the newest: `totalValue` is only as current
    // as its least current input.
    const markTimes = positions
      .map((p) => p.updatedAt)
      .filter((d): d is Date => d instanceof Date);
    const marksAsOf = markTimes.length
      ? new Date(Math.min(...markTimes.map((d) => d.getTime())))
      : null;
    const marksStale =
      marksAsOf !== null && Date.now() - marksAsOf.getTime() > MARK_STALE_AFTER_MS;

    return {
      ...portfolio,
      positions,
      totalValue,
      unrealisedPnl,
      totalPnl: portfolio.realisedPnl + unrealisedPnl,
      marksAsOf,
      marksStale,
    };
  }

  async listPortfolios(userId: string) {
    await this.ensurePortfolio(userId, Exchange.NSE);
    return this.portfolioModel.find({ userId }).lean();
  }

  async getOrders(userId: string, limit = 50) {
    return this.orderModel.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
  }

  async getTrades(userId: string, limit = 100) {
    return this.tradeModel.find({ userId }).sort({ executedAt: -1 }).limit(limit).lean();
  }

  async getPositions(userId: string) {
    return this.positionModel.find({ userId }).lean();
  }

  /** Every open position, for every user — read only by the 15:20 square-off. */
  async openPositionsAcrossUsers() {
    return this.positionModel.find({ quantity: { $gt: 0 } }).lean();
  }

  // ------------------------------------------------------------------
  // Marks
  // ------------------------------------------------------------------

  /** Live price, or a failure the caller can report rather than swallow. */
  async fetchLtp(symbol: string, exchange: string): Promise<number> {
    try {
      return await this.market.ltp(symbol, exchange);
    } catch (e) {
      throw new BadRequestException(
        `Could not fetch live price for ${symbol}/${exchange}: ${(e as Error).message}`,
      );
    }
  }

  async refreshPositionPrices(userId: string): Promise<RefreshPricesResult> {
    const positions = await this.positionModel.find({ userId });
    const staleSymbols: string[] = [];
    let refreshed = 0;

    for (const pos of positions) {
      try {
        const ltp = await this.fetchLtp(pos.symbol, pos.exchange);
        pos.currentPrice = ltp;
        pos.unrealisedPnl = (ltp - pos.averageCost) * pos.quantity;
        await pos.save();
        refreshed += 1;
      } catch (err) {
        // Non-fatal — the last known price is kept, but the caller is told
        // which symbols are stale instead of being shown a silently outdated
        // unrealised P&L.
        staleSymbols.push(pos.symbol);
        this.logger.warn(
          `Stale price kept for ${pos.symbol}/${pos.exchange}: ${(err as Error).message}`,
        );
      }
    }

    const fresh = await this.positionModel.find({ userId }).lean();
    this.gateway.emitPositionUpdate(userId, fresh);

    return { positions: fresh, refreshed, stale: staleSymbols.length, staleSymbols };
  }
}
