import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { CreatePortfolioDto } from './dto/create-portfolio.dto';
import { PlaceOrderDto } from './dto/place-order.dto';
import { OrderExecutionService } from './order-execution.service';
import { PortfolioAccountsService } from './portfolio-accounts.service';
import { RiskLimitsService } from './risk-limits.service';
import { Exchange, PaperPortfolioDocument } from './schemas/paper-portfolio.schema';
import {
  OrderSide,
  OrderStatus,
  OrderType,
  PaperOrder,
  PaperOrderDocument,
} from './schemas/paper-order.schema';
import { PaperTrade, PaperTradeDocument } from './schemas/paper-trade.schema';
import {
  PlaceOrderResult,
  SquareOffResult,
  placementResult,
} from './paper-trading.types';

export * from './paper-trading.types';

/**
 * Placing an order, and the one job that has no other home: the end-of-session
 * flatten.
 *
 * This file used to be 811 lines holding the account read model, every risk
 * limit, the execution sequence, the position maths and the query helpers. It
 * is now the entry point that composes them, and the three collaborators can
 * each be read in one sitting:
 *
 *   * `portfolio-accounts.service.ts` — the account and everything that reads it
 *   * `risk-limits.service.ts`        — the limits and the gate
 *   * `order-execution.service.ts`    — where money actually moves
 *
 * The delegating methods below are kept because controllers, the internal API
 * and the chat agent's context endpoint all call this service by name. They are
 * one line each and exist so that split did not become a breaking change.
 */
@Injectable()
export class PaperTradingService {
  private readonly logger = new Logger(PaperTradingService.name);

  constructor(
    @InjectModel(PaperOrder.name)
    private readonly orderModel: Model<PaperOrderDocument>,
    @InjectModel(PaperTrade.name)
    private readonly tradeModel: Model<PaperTradeDocument>,
    private readonly accounts: PortfolioAccountsService,
    private readonly risk: RiskLimitsService,
    private readonly execution: OrderExecutionService,
  ) {}

  // ------------------------------------------------------------------
  // Order placement
  // ------------------------------------------------------------------

  async placeOrder(userId: string, dto: PlaceOrderDto): Promise<PlaceOrderResult> {
    const exchange = dto.exchange.toUpperCase() as Exchange;
    // Every user always has an account — create it on the fly if this is their first trade.
    const portfolio = await this.accounts.ensurePortfolio(userId, exchange);

    // A repeat of an order already placed under this key is answered with the
    // original, not a second position. Checked before the write for the common
    // case; the unique index is what actually makes it safe.
    if (dto.clientOrderId) {
      const existing = await this.findByClientOrderId(userId, dto.clientOrderId);
      if (existing) return existing;
    }

    let order: PaperOrderDocument;
    try {
      order = await this.orderModel.create({
        portfolioId: portfolio._id,
        userId,
        symbol: dto.symbol.toUpperCase(),
        exchange,
        side: dto.side,
        type: dto.type ?? OrderType.MARKET,
        quantity: dto.quantity,
        limitPrice: dto.limitPrice,
        stopLoss: dto.stopLoss,
        status: OrderStatus.PENDING,
        clientOrderId: dto.clientOrderId,
        decisionTurnId: dto.decisionTurnId,
      });
    } catch (err) {
      // Two requests with the same key arriving together both pass the check
      // above; the index rejects the loser, which then reads the winner's order.
      // Losing this race is a success, not an error.
      const duplicate = await this.resolveDuplicateKey(err, userId, dto.clientOrderId);
      if (duplicate) return duplicate;
      throw err;
    }

    if (dto.side === OrderSide.BUY) {
      await this.risk.guardBuyOrder(order, exchange);
    }

    // Market orders execute immediately
    if (order.type === OrderType.MARKET) {
      const executed = await this.execution.executeOrder(order._id.toString(), portfolio);
      return placementResult(executed.order, executed.trade);
    }

    return placementResult(order, null);
  }

  /**
   * The order already placed under this key, in the same shape a fresh
   * placement returns — including its fill, so a retrying client sees the price
   * it actually got rather than an order that looks unexecuted.
   */
  private async findByClientOrderId(
    userId: string,
    clientOrderId: string,
  ): Promise<PlaceOrderResult | null> {
    const order = await this.orderModel.findOne({ userId, clientOrderId });
    if (!order) return null;

    const trade =
      order.status === OrderStatus.EXECUTED
        ? await this.tradeModel.findOne({ orderId: order._id })
        : null;

    this.logger.log(
      `Duplicate order request ignored for ${order.symbol} ` +
        `(clientOrderId ${clientOrderId}) — returning the original`,
    );
    return placementResult(order, trade);
  }

  /** Whether a write failed on the idempotency index, and if so, the winner. */
  private async resolveDuplicateKey(
    err: unknown,
    userId: string,
    clientOrderId?: string,
  ): Promise<PlaceOrderResult | null> {
    const isDuplicateKey = (err as { code?: number })?.code === 11000;
    if (!isDuplicateKey || !clientOrderId) return null;
    return this.findByClientOrderId(userId, clientOrderId);
  }

  // ------------------------------------------------------------------
  // End-of-session square-off
  // ------------------------------------------------------------------

  /**
   * Close every open paper position at market, across every user.
   *
   * Triggered at 15:20 IST by the signals worker's Celery beat, which is the
   * point from which real brokers force-close intraday positions. The product
   * has always claimed "intraday positions only" while the paper account held
   * them indefinitely, so a strategy that reports no overnight exposure was
   * silently carrying every gap.
   *
   * Deliberately NOT routed through `placeOrder`: the risk limits there exist
   * to stop new exposure being opened, and a flatten must never be refused.
   * One position failing (no price, upstream down) must not abandon the rest,
   * so each is closed independently and failures are reported, not thrown.
   */
  async squareOffAll(): Promise<SquareOffResult> {
    const positions = await this.accounts.openPositionsAcrossUsers();
    const details: SquareOffResult['details'] = [];
    let closed = 0;
    let failed = 0;

    for (const pos of positions) {
      try {
        const order = await this.orderModel.create({
          portfolioId: pos.portfolioId,
          userId: pos.userId,
          symbol: pos.symbol,
          exchange: pos.exchange,
          side: OrderSide.SELL,
          type: OrderType.MARKET,
          quantity: pos.quantity,
          status: OrderStatus.PENDING,
        });
        const result = await this.execution.executeOrder(order._id.toString());
        closed += 1;
        details.push({
          userId: pos.userId,
          symbol: pos.symbol,
          quantity: pos.quantity,
          exitPrice: result.order.executedPrice,
        });
      } catch (err) {
        failed += 1;
        const message = (err as Error).message;
        details.push({
          userId: pos.userId,
          symbol: pos.symbol,
          quantity: pos.quantity,
          error: message,
        });
        // Loud: the failure mode here is holding a position overnight.
        this.logger.error(
          `Square-off FAILED for ${pos.userId}/${pos.symbol} × ${pos.quantity}: ${message}`,
        );
      }
    }

    this.logger.log(`Square-off complete — ${closed} closed, ${failed} failed`);
    return { closed, failed, details };
  }

  // ------------------------------------------------------------------
  // Delegation. One line each, so the split was not a breaking change.
  // ------------------------------------------------------------------

  createPortfolio(userId: string, dto: CreatePortfolioDto) {
    return this.accounts.createPortfolio(userId, dto);
  }

  ensurePortfolio(userId: string, exchange: Exchange, initialCapital?: number) {
    return this.accounts.ensurePortfolio(userId, exchange, initialCapital);
  }

  resetPortfolio(userId: string, exchange: Exchange = Exchange.NSE) {
    return this.accounts.resetPortfolio(userId, exchange);
  }

  getPortfolio(userId: string, exchange: Exchange) {
    return this.accounts.getPortfolio(userId, exchange);
  }

  listPortfolios(userId: string) {
    return this.accounts.listPortfolios(userId);
  }

  getOrders(userId: string, limit = 50) {
    return this.accounts.getOrders(userId, limit);
  }

  getTrades(userId: string, limit = 100) {
    return this.accounts.getTrades(userId, limit);
  }

  getPositions(userId: string) {
    return this.accounts.getPositions(userId);
  }

  refreshPositionPrices(userId: string) {
    return this.accounts.refreshPositionPrices(userId);
  }

  getRiskState(userId: string, exchange: Exchange = Exchange.NSE) {
    return this.risk.getRiskState(userId, exchange);
  }

  executeOrder(
    orderId: string,
    portfolio?: PaperPortfolioDocument,
    requestingUserId?: string,
  ) {
    return this.execution.executeOrder(orderId, portfolio, requestingUserId);
  }
}
