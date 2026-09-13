import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Signal, SignalDocument } from './schemas/signal.schema';
import { SignalsGateway } from './signals.gateway';
import { SignalMessage, toSignalDocument } from './signal.mapper';
import { SignalsUpstreamClient } from './signals-upstream.client';
import {
  bucketBy, DEDUPE_WINDOW_MS, indexOutcomes, isDuplicateSetup,
  performanceStats, SignalOutcome, UNEVALUATED,
} from './eval';

type EvaluatedSignal = Record<string, unknown> & SignalOutcome & {
  symbol: string;
  confidence: number;
};

@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);

  constructor(
    @InjectModel(Signal.name) private readonly signalModel: Model<SignalDocument>,
    private readonly gateway: SignalsGateway,
    private readonly upstream: SignalsUpstreamClient,
  ) {}

  /**
   * Persist one signal and broadcast it.
   *
   * Called by the signals service over the internal endpoint. A retried POST
   * must be a no-op rather than a second document: the unique
   * (symbol, generatedAt, direction) index on SignalSchema makes that a
   * duplicate-key error, which is caught here and skipped.
   * Returns the saved document, or null when the signal was already stored.
   */
  async persistSignal(payload: SignalMessage): Promise<SignalDocument | null> {
    const doc = toSignalDocument(payload);

    // Suppress a restatement of a setup we already hold. The screener re-runs
    // every 15 minutes, so a trend that persists for two hours generates ~8
    // signals describing one idea — each of which used to be scored as an
    // independent trade in the published win rate.
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const recent = await this.signalModel
      .find({ symbol: doc.symbol, direction: doc.direction, createdAt: { $gte: since } })
      .select('symbol direction entryPrice generatedAt createdAt')
      .lean();

    const candidate = {
      symbol: doc.symbol!,
      direction: doc.direction!,
      entryPrice: doc.entryPrice!,
      generatedAt: doc.generatedAt ?? new Date(),
    };
    const priors = recent.map((r) => ({
      symbol: r.symbol,
      direction: r.direction,
      entryPrice: r.entryPrice,
      generatedAt: (r.generatedAt ?? r.createdAt) as Date,
    }));

    if (isDuplicateSetup(candidate, priors)) {
      this.logger.log(
        `Duplicate setup ignored: ${doc.symbol} ${doc.direction} @ ${doc.entryPrice} ` +
        `(restates a signal from the last ${DEDUPE_WINDOW_MS / 3_600_000}h)`,
      );
      return null;
    }

    try {
      const signal = await this.signalModel.create(doc);
      this.gateway.broadcastSignal(signal.toObject());
      return signal;
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        this.logger.log(
          `Duplicate signal ignored: ${payload.symbol} ${payload.direction} @ ${payload.generated_at}`,
        );
        return null;
      }
      throw err;
    }
  }

  async getRecentSignals(limit = 50) {
    return this.signalModel.find().sort({ createdAt: -1 }).limit(limit).lean();
  }

  async getSignalsBySymbol(symbol: string, limit = 20) {
    return this.signalModel
      .find({ symbol: symbol.toUpperCase() })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  // ------------------------------------------------------------------
  // Backtest stored signals against real historical bars: for each signal,
  // walk forward from its generation time and see whether target or stop hit
  // first. No background worker — pure historical evaluation on demand.
  //
  // The evaluation itself is delegated to the signals service, which is the
  // single owner of the rules (gap-through-stop fills at the bar open,
  // round-trip costs). This endpoint used to run its own TypeScript copy with
  // neither, so the two performance figures the product reports disagreed by
  // at least the cost figure on every trade. See src/signals/eval.ts.
  // ------------------------------------------------------------------
  async evaluatePerformance(limit = 40) {
    const signals = await this.signalModel.find().sort({ createdAt: -1 }).limit(limit).lean();

    let outcomes = new Map<string, SignalOutcome>();
    try {
      // 5m bars — finer first-touch resolution than 15m, less "which hit first"
      // ambiguity within a single candle (still resolved conservatively either way).
      const rows = await this.upstream.evaluate(
        signals.map((s) => ({
          id: String(s._id),
          symbol: s.symbol,
          exchange: s.exchange,
          direction: s.direction,
          entry_price: s.entryPrice,
          target_price: s.targetPrice,
          stop_loss: s.stopLoss,
          generated_at: new Date(
            (s.generatedAt ?? s.createdAt) as Date | string,
          ).toISOString(),
        })),
        '5m',
        58,
      );
      outcomes = indexOutcomes(rows);
    } catch (err) {
      // Degrade to "not evaluated" rather than failing the whole page. Every
      // row reports NO_DATA, which is visibly different from a 0% win rate.
      this.logger.error('Signal evaluation upstream failed', err);
    }

    const evaluated: EvaluatedSignal[] = signals.map((s) => ({
      ...s,
      ...(outcomes.get(String(s._id)) ?? UNEVALUATED),
    }) as EvaluatedSignal);

    const closed = evaluated.filter(e => e.outcome === 'TARGET_HIT' || e.outcome === 'STOP_HIT');
    const wins = closed.filter(e => e.outcome === 'TARGET_HIT');
    const avgPnl = closed.length ? closed.reduce((a, e) => a + e.pnlPct, 0) / closed.length : 0;

    // Breakeven, expectancy and the confidence interval are computed here
    // because the frontend cannot: they need the realised win/loss ratio across
    // the whole resolved set. Without `breakevenWinRate` the Performance page
    // colours the win rate against 50%, which for this system is roughly 15
    // points above the bar that actually matters.
    const stats = performanceStats(closed);

    return {
      signals: evaluated,
      summary: {
        total: evaluated.length,
        resolved: closed.length,
        wins: wins.length,
        losses: closed.length - wins.length,
        open: evaluated.filter(e => e.outcome === 'OPEN').length,
        noData: evaluated.filter(e => e.outcome === 'NO_DATA').length,
        avgPnlPct: Math.round(avgPnl * 100) / 100,
        // Includes `winRate` — to 2dp rather than the whole number this used to
        // report. A system whose breakeven is 34.6% cannot be judged on a win
        // rate rounded to the nearest point.
        ...stats,
      },
      byConfidence: bucketBy(closed, e =>
        e.confidence >= 0.8 ? '0.80+' : e.confidence >= 0.7 ? '0.70-0.79' : '0.65-0.69'),
      bySymbol: bucketBy(closed, e => e.symbol),
    };
  }
}
