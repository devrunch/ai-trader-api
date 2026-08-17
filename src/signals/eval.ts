/**
 * Aggregation and presentation of signal outcomes.
 *
 * There is deliberately NO evaluator here any more. Outcome evaluation — "did
 * this signal hit target or stop first, and what was the P&L" — used to be
 * implemented twice, once here in TypeScript and once in Python, with
 * DIFFERENT RULES: the Python one fills a gapped stop at the bar open and
 * subtracts a round-trip cost model; this one filled at the exact stop price
 * and applied no costs. Those are the two numbers the product uses to tell the
 * user whether the system works, and they disagreed systematically, this side
 * optimistic by at least the cost figure plus every gap.
 *
 * The Python service now owns it (`POST /signals/evaluate`). Aggregation and
 * bucketing stay here, because presentation is legitimately the API's job.
 */

import { round2 } from '../portfolio/paper-trading.types';

export type SignalOutcomeKind = 'TARGET_HIT' | 'STOP_HIT' | 'OPEN' | 'NO_DATA';

export interface SignalOutcome {
  outcome: SignalOutcomeKind;
  exitPrice: number | null;
  pnlPct: number;
}

/** One row of `POST /signals/evaluate`'s response (snake_case, as Python sends it). */
export interface UpstreamOutcome {
  id?: string | null;
  symbol: string;
  outcome: SignalOutcomeKind;
  exit_price: number | null;
  pnl_pct: number | null;
}

export interface Bucket {
  key: string;
  trades: number;
  winRate: number;
  avgPnlPct: number;
}

/** Anything `bucketBy` needs off an evaluated signal. */
export interface BucketableOutcome {
  outcome: SignalOutcomeKind | string;
  pnlPct: number;
}

/** Outcome used when the evaluator returned nothing for a signal. */
export const UNEVALUATED: SignalOutcome = {
  outcome: 'NO_DATA',
  exitPrice: null,
  pnlPct: 0,
};

/**
 * Index upstream rows by signal id and convert to the camelCase shape the
 * frontend already consumes.
 *
 * Matching is by id rather than by array position: the evaluator is free to
 * return rows in any order, and silently pairing the wrong outcome with the
 * wrong signal is exactly the class of bug this whole change exists to remove.
 */
export function indexOutcomes(rows: UpstreamOutcome[]): Map<string, SignalOutcome> {
  const byId = new Map<string, SignalOutcome>();
  for (const r of rows) {
    if (!r?.id) continue;
    byId.set(r.id, {
      outcome: r.outcome,
      exitPrice: r.exit_price ?? null,
      pnlPct: r.pnl_pct ?? 0,
    });
  }
  return byId;
}

/**
 * The statistics that decide whether this system makes money.
 *
 * Win rate alone is not one of them, and presenting it alone is why the
 * Performance page currently teaches users the wrong standard. What matters is
 * expectancy — expected value per trade:
 *
 *     expectancy = winRate × avgWin − lossRate × avgLoss
 *
 * If the average win is 3× the average loss you break even at a 25% win rate.
 * Real trend-following systems run 30–40% win rates profitably. So every system
 * has its OWN breakeven win rate, set by its realised win/loss ratio, and that
 * is the only bar worth colouring against.
 */
export interface PerformanceStats {
  /** Resolved trades the statistics are computed from. */
  sampleSize: number;
  winRate: number;
  avgWinPct: number;
  /** Positive magnitude, not a signed number. */
  avgLossPct: number;
  /** avgWin / avgLoss. Null when there are no losses to divide by. */
  winLossRatio: number | null;
  /**
   * Win rate at which this system breaks even, given its own win/loss ratio.
   * Colour the win rate against THIS, never against 50%.
   */
  breakevenWinRate: number | null;
  /** Expected P&L per trade, in percent. Costs are already inside pnlPct. */
  expectancyPct: number;
  /** 95% CI on expectancy. Spans zero => the sign is not established. */
  expectancyCi95: { low: number; high: number } | null;
  /** True when the CI includes zero — the honest "we cannot tell yet" flag. */
  inconclusive: boolean;
}

/**
 * How long the same setup is treated as one idea rather than many.
 *
 * The screener re-evaluates every symbol every 15 minutes, so a setup that
 * persists regenerates each time — and each copy used to be stored and scored
 * as an INDEPENDENT trade. A single two-hour trend could occupy 20% of a
 * 100-trade performance sample, which means the statistic was measuring
 * persistence rather than accuracy, and the effective sample size was far
 * smaller than the row count implied.
 *
 * This is NOT the same as the unique (symbol, generatedAt, direction) index.
 * That one makes at-least-once SQS redelivery of the SAME message idempotent.
 * This is a DIFFERENT message, generated 15 minutes later, describing the same
 * idea at nearly the same price.
 */
export const DEDUPE_WINDOW_MS = 4 * 60 * 60 * 1000;

/** Entries within this fraction of each other are the same idea. */
export const DEDUPE_PRICE_TOLERANCE = 0.005;

export interface DedupeCandidate {
  symbol: string;
  direction: string;
  entryPrice: number;
  generatedAt: Date | string;
}

/**
 * True when `incoming` restates a signal already stored in `recent`.
 *
 * `recent` should be the stored signals for the same symbol within the window;
 * the caller does the query so this stays pure and testable.
 */
export function isDuplicateSetup(
  incoming: DedupeCandidate,
  recent: DedupeCandidate[],
  windowMs = DEDUPE_WINDOW_MS,
  tolerance = DEDUPE_PRICE_TOLERANCE,
): boolean {
  const at = new Date(incoming.generatedAt).getTime();
  if (Number.isNaN(at) || !incoming.entryPrice) return false;

  return recent.some((prior) => {
    if (prior.symbol !== incoming.symbol) return false;
    if (prior.direction !== incoming.direction) return false;
    const priorAt = new Date(prior.generatedAt).getTime();
    if (Number.isNaN(priorAt)) return false;
    // Absolute difference: a signal arriving slightly out of order is still the
    // same idea, and clock skew between services should not defeat this.
    if (Math.abs(at - priorAt) > windowMs) return false;
    const drift = Math.abs(prior.entryPrice - incoming.entryPrice) / incoming.entryPrice;
    return drift <= tolerance;
  });
}

export function performanceStats(closed: BucketableOutcome[]): PerformanceStats {
  const n = closed.length;
  const empty: PerformanceStats = {
    sampleSize: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0,
    winLossRatio: null, breakevenWinRate: null, expectancyPct: 0,
    expectancyCi95: null, inconclusive: true,
  };
  if (n === 0) return empty;

  const wins = closed.filter((e) => e.outcome === 'TARGET_HIT');
  const losses = closed.filter((e) => e.outcome === 'STOP_HIT');
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  const avgWin = wins.length ? mean(wins.map((e) => e.pnlPct)) : 0;
  // Magnitude — losses are negative in pnlPct and the ratio needs both positive.
  const avgLoss = losses.length ? Math.abs(mean(losses.map((e) => e.pnlPct))) : 0;
  const winRate = (wins.length / n) * 100;

  // Breakeven: the win rate w where w × avgWin = (1 − w) × avgLoss.
  const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : null;
  const breakeven =
    winLossRatio !== null && winLossRatio + 1 > 0 ? (1 / (winLossRatio + 1)) * 100 : null;

  // Expectancy straight off realised P&L rather than from the components —
  // identical in expectation and immune to rounding drift between them.
  const pnls = closed.map((e) => e.pnlPct);
  const expectancy = mean(pnls);

  // 95% CI on the mean. Normal approximation: fine at n≳30, and the honest
  // signal at small n is the width of the interval, which this still conveys.
  let ci: { low: number; high: number } | null = null;
  if (n > 1) {
    const variance = pnls.reduce((a, p) => a + (p - expectancy) ** 2, 0) / (n - 1);
    const stdErr = Math.sqrt(variance / n);
    ci = { low: round2(expectancy - 1.96 * stdErr), high: round2(expectancy + 1.96 * stdErr) };
  }

  return {
    sampleSize: n,
    winRate: round2(winRate),
    avgWinPct: round2(avgWin),
    avgLossPct: round2(avgLoss),
    winLossRatio: winLossRatio === null ? null : round2(winLossRatio),
    breakevenWinRate: breakeven === null ? null : round2(breakeven),
    expectancyPct: Math.round(expectancy * 1000) / 1000,
    expectancyCi95: ci,
    // No CI (n≤1) is not evidence of anything either.
    inconclusive: ci === null || (ci.low <= 0 && ci.high >= 0),
  };
}

export function bucketBy<T extends BucketableOutcome>(
  closed: T[],
  keyFn: (e: T) => string,
): Bucket[] {
  const groups = new Map<string, T[]>();
  for (const e of closed) {
    const k = keyFn(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  return [...groups.entries()]
    .map(([key, items]) => {
      const wins = items.filter((i) => i.outcome === 'TARGET_HIT').length;
      return {
        key,
        trades: items.length,
        winRate: Math.round((wins / items.length) * 100),
        avgPnlPct:
          Math.round((items.reduce((a, i) => a + i.pnlPct, 0) / items.length) * 100) / 100,
      };
    })
    .sort((a, b) => b.trades - a.trades);
}
