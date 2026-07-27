import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { sessionStart } from '../common/market-session';
import { PortfolioAccountsService } from './portfolio-accounts.service';
import { Exchange } from './schemas/paper-portfolio.schema';
import { OrderStatus, PaperOrderDocument } from './schemas/paper-order.schema';
import { PaperTrade, PaperTradeDocument } from './schemas/paper-trade.schema';
import { PortfolioView, RiskState, round2 } from './paper-trading.types';

/**
 * The limits, and the one gate that enforces them.
 *
 * Two facts combine badly and neither is visible from inside a single order.
 * At a ~30% win rate a run of ten consecutive losers inside a hundred trades
 * is the expected outcome, not bad luck. And the universe is 25 large-cap
 * Nifty names — five banks, four IT companies — which fall together, so eight
 * open positions is far closer to one bet at eight times size than to eight
 * independent bets. Nothing in the engine noticed either.
 *
 * All three limits are deliberately blunt constants rather than settings:
 * a risk limit a user can raise from the UI is not a risk limit.
 */
@Injectable()
export class RiskLimitsService {
  /** Most positions that may be open at once. */
  static readonly MAX_CONCURRENT_POSITIONS = 5;

  /** Aggregate open risk ceiling, as a percentage of account value. */
  static readonly MAX_AGGREGATE_RISK_PCT = 3;

  /** Realised loss in one session, as a percentage of account value, that halts new buying. */
  static readonly MAX_DAILY_LOSS_PCT = 3;

  /**
   * Adverse move assumed for a position that declared no stop.
   *
   * This number is a CAP INPUT, not a risk estimate, and it must never be
   * presented to a user as one. There is no STOP order type and no monitoring
   * loop, so a position with no declared stop has genuinely unbounded downside;
   * `openRiskIsUnbounded` on the risk state says exactly that. 5% is chosen to
   * be wide relative to a real intraday stop on a Nifty large cap, so the
   * aggregate cap errs towards refusing trades rather than allowing them.
   */
  static readonly ASSUMED_STOP_PCT_WHEN_UNSET = 5;

  constructor(
    @InjectModel(PaperTrade.name)
    private readonly tradeModel: Model<PaperTradeDocument>,
    private readonly accounts: PortfolioAccountsService,
  ) {}

  /** Risk carried by one open position, in rupees. */
  static positionRisk(p: {
    quantity: number;
    averageCost: number;
    stopLoss?: number;
  }): number {
    // A stop above the entry on a long is not a stop, it is a typo — fall back
    // to the assumption rather than booking negative risk.
    if (p.stopLoss !== undefined && p.stopLoss > 0 && p.stopLoss < p.averageCost) {
      return (p.averageCost - p.stopLoss) * p.quantity;
    }
    return (p.averageCost * p.quantity * RiskLimitsService.ASSUMED_STOP_PCT_WHEN_UNSET) / 100;
  }

  /**
   * The account's standing against every limit, optionally including an order
   * that has not been placed yet.
   *
   * `prospective` is what makes the aggregate cap answer "would this order push
   * me past the line", rather than only "am I already past it".
   */
  async stateFrom(
    view: PortfolioView,
    prospective?: { symbol: string; quantity: number; price: number; stopLoss?: number },
  ): Promise<RiskState> {
    const from = sessionStart();
    const trades = await this.tradeModel
      .find({ userId: view.userId, exchange: view.exchange, executedAt: { $gte: from } })
      .lean();

    const accountValue = view.totalValue;
    const positions = view.positions;

    let openRisk = positions.reduce((sum, p) => sum + RiskLimitsService.positionRisk(p), 0);
    let openPositions = positions.length;
    const positionsWithoutStop = positions.filter((p) => !p.stopLoss).length;

    if (prospective) {
      openRisk += RiskLimitsService.positionRisk({
        quantity: prospective.quantity,
        averageCost: prospective.price,
        stopLoss: prospective.stopLoss,
      });
      // Adding to a position the account already holds does not open a new one.
      if (!positions.some((p) => p.symbol === prospective.symbol)) openPositions += 1;
    }

    const sessionRealisedPnl = trades.reduce((s, t) => s + (t.realisedPnl ?? 0), 0);
    // Percentages are against CURRENT account value, not starting capital: a
    // drawn-down account should be allowed to risk less, not the same amount.
    const pct = (n: number) => (accountValue > 0 ? (n / accountValue) * 100 : 0);
    const openRiskPct = pct(openRisk);
    const sessionRealisedPnlPct = pct(sessionRealisedPnl);

    let blockedReason: string | null = null;
    if (sessionRealisedPnlPct <= -RiskLimitsService.MAX_DAILY_LOSS_PCT) {
      blockedReason =
        `Daily loss limit reached: down ₹${Math.abs(sessionRealisedPnl).toFixed(2)} ` +
        `(${sessionRealisedPnlPct.toFixed(2)}%) this session, limit is ` +
        `${RiskLimitsService.MAX_DAILY_LOSS_PCT}%. No new positions until the next session.`;
    } else if (openPositions > RiskLimitsService.MAX_CONCURRENT_POSITIONS) {
      blockedReason =
        `Position limit reached: ${positions.length} open, maximum is ` +
        `${RiskLimitsService.MAX_CONCURRENT_POSITIONS}. Close something before opening more — ` +
        `these names move together, so more positions is mostly more of the same bet.`;
    } else if (openRiskPct > RiskLimitsService.MAX_AGGREGATE_RISK_PCT) {
      blockedReason =
        `Aggregate risk limit reached: this order would take open risk to ` +
        `₹${openRisk.toFixed(2)} (${openRiskPct.toFixed(2)}% of account), limit is ` +
        `${RiskLimitsService.MAX_AGGREGATE_RISK_PCT}%.` +
        (positionsWithoutStop > 0 || (prospective && !prospective.stopLoss)
          ? ` Positions with no declared stop are counted at an assumed ` +
            `${RiskLimitsService.ASSUMED_STOP_PCT_WHEN_UNSET}% adverse move; ` +
            `sending a stopLoss with the order measures the real number instead.`
          : '');
    }

    return {
      accountValue: round2(accountValue),
      openPositions: positions.length,
      maxConcurrentPositions: RiskLimitsService.MAX_CONCURRENT_POSITIONS,
      openRisk: round2(openRisk),
      openRiskPct: round2(openRiskPct),
      maxAggregateRiskPct: RiskLimitsService.MAX_AGGREGATE_RISK_PCT,
      sessionRealisedPnl: round2(sessionRealisedPnl),
      sessionRealisedPnlPct: round2(sessionRealisedPnlPct),
      maxDailyLossPct: RiskLimitsService.MAX_DAILY_LOSS_PCT,
      sessionStart: from.toISOString(),
      positionsWithoutStop,
      // The honest qualifier on every number above. Nothing in this engine
      // will ever execute a stop, so a position's real downside is not capped.
      openRiskIsUnbounded: positionsWithoutStop > 0 || positions.length > 0,
      blocked: blockedReason !== null,
      blockedReason,
    };
  }

  /** Current limit state for an account — surfaced to the UI and the chat agent. */
  async getRiskState(userId: string, exchange: Exchange = Exchange.NSE): Promise<RiskState> {
    return this.stateFrom(await this.accounts.getPortfolio(userId, exchange));
  }

  private async rejectOrder(order: PaperOrderDocument, reason: string): Promise<void> {
    order.status = OrderStatus.REJECTED;
    order.rejectionReason = reason;
    await order.save();
  }

  /**
   * Gate a BUY against the risk limits before anything is executed.
   *
   * SELLs are never gated. Every limit here exists to stop new exposure being
   * opened; blocking an exit would trap the user inside the very position the
   * limit is worried about, and would break the 15:20 square-off.
   */
  async guardBuyOrder(order: PaperOrderDocument, exchange: Exchange): Promise<void> {
    let price: number;
    try {
      price = order.limitPrice ?? (await this.accounts.fetchLtp(order.symbol, order.exchange));
    } catch {
      // Fail closed. A risk check that waves orders through when its input is
      // missing is worse than no risk check, because it is invisible.
      await this.rejectOrder(order, 'Live price unavailable — risk limits could not be checked');
      throw new BadRequestException(
        `Cannot price ${order.symbol} right now, so the risk limits cannot be checked. ` +
          `Order rejected rather than placed unchecked.`,
      );
    }

    const view = await this.accounts.getPortfolio(order.userId, exchange);

    // Affordability is checked here as well as in executeOrder so an order the
    // account simply cannot fund reports that, rather than tripping a risk
    // percentage that is meaningless on an unfundable trade. This pre-check is
    // ADVISORY: the authoritative, race-free guard is still the conditional
    // `findOneAndUpdate({ cashBalance: { $gte } }, { $inc })` in executeOrder,
    // which is what stops two concurrent orders spending the same rupee.
    const cost = price * order.quantity;
    if (cost > view.cashBalance) {
      await this.rejectOrder(order, 'Insufficient cash balance');
      throw new BadRequestException(
        `Insufficient balance. Required ₹${cost.toFixed(2)}, available ₹${view.cashBalance.toFixed(2)}`,
      );
    }

    const state = await this.stateFrom(view, {
      symbol: order.symbol,
      quantity: order.quantity,
      price,
      stopLoss: order.stopLoss,
    });
    if (state.blocked) {
      await this.rejectOrder(order, state.blockedReason!);
      throw new BadRequestException(state.blockedReason!);
    }
  }
}
