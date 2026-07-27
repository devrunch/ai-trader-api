import {
  bucketBy, type DedupeCandidate, indexOutcomes, isDuplicateSetup,
  performanceStats, UNEVALUATED, type UpstreamOutcome,
} from './eval';

/**
 * `evalSignal` no longer exists here — outcome evaluation moved to the Python
 * signals service so there is one implementation of the rules instead of two
 * that disagreed (audit HIGH-3). Its behavioural tests live in
 * `ai-trader-signals/tests/test_evaluator.py`, which additionally covers the
 * gap-through-stop fill and the cost model this side never had.
 *
 * What remains testable here is the boundary: turning the upstream response
 * into the shape the frontend consumes, and the aggregation.
 */

describe('indexOutcomes', () => {
  const rows: UpstreamOutcome[] = [
    { id: 'b', symbol: 'TCS', outcome: 'STOP_HIT', exit_price: 90, pnl_pct: -10.12 },
    { id: 'a', symbol: 'RELIANCE', outcome: 'TARGET_HIT', exit_price: 110, pnl_pct: 9.88 },
  ];

  it('maps snake_case upstream rows to the camelCase shape the frontend reads', () => {
    const byId = indexOutcomes(rows);
    expect(byId.get('a')).toEqual({ outcome: 'TARGET_HIT', exitPrice: 110, pnlPct: 9.88 });
    expect(byId.get('b')).toEqual({ outcome: 'STOP_HIT', exitPrice: 90, pnlPct: -10.12 });
  });

  it('matches by id, not by position — a reordered response must not mispair', () => {
    // `rows` is deliberately returned b-then-a while the caller's signals are
    // a-then-b. Pairing by index would attach TCS's loss to RELIANCE.
    const byId = indexOutcomes(rows);
    expect(byId.get('a')!.outcome).toBe('TARGET_HIT');
  });

  it('drops rows with no id rather than keying them as undefined', () => {
    const byId = indexOutcomes([
      { id: null, symbol: 'X', outcome: 'OPEN', exit_price: 1, pnl_pct: 0 },
    ]);
    expect(byId.size).toBe(0);
  });

  it('treats a null exit price and a missing P&L as unresolved, not as zero profit', () => {
    const byId = indexOutcomes([
      { id: 'c', symbol: 'Y', outcome: 'NO_DATA', exit_price: null, pnl_pct: null },
    ]);
    expect(byId.get('c')).toEqual({ outcome: 'NO_DATA', exitPrice: null, pnlPct: 0 });
  });

  it('UNEVALUATED is the fallback when upstream returned nothing for a signal', () => {
    expect(UNEVALUATED.outcome).toBe('NO_DATA');
    expect(UNEVALUATED.exitPrice).toBeNull();
  });
});

describe('bucketBy', () => {
  it('groups, computes win rate and average P&L, and sorts by trade count', () => {
    const rows = [
      { key: 'A', outcome: 'TARGET_HIT', pnlPct: 10 },
      { key: 'A', outcome: 'STOP_HIT', pnlPct: -5 },
      { key: 'A', outcome: 'TARGET_HIT', pnlPct: 6 },
      { key: 'B', outcome: 'STOP_HIT', pnlPct: -4 },
    ];

    const buckets = bucketBy(rows, (r) => r.key);

    expect(buckets.map((b) => b.key)).toEqual(['A', 'B']);
    expect(buckets[0]).toEqual({
      key: 'A',
      trades: 3,
      winRate: 67,
      avgPnlPct: 3.67,
    });
    expect(buckets[1]).toEqual({
      key: 'B',
      trades: 1,
      winRate: 0,
      avgPnlPct: -4,
    });
  });
});

describe('performanceStats', () => {
  const win = (pnlPct: number) => ({ outcome: 'TARGET_HIT' as const, pnlPct });
  const loss = (pnlPct: number) => ({ outcome: 'STOP_HIT' as const, pnlPct });

  it('breakeven sits BELOW 50% when wins are bigger than losses', () => {
    // avgWin 3.0, avgLoss 1.0 -> ratio 3 -> breakeven 1/(3+1) = 25%.
    // This is the whole point: a 30% win rate here is profitable.
    const s = performanceStats([win(3), win(3), loss(-1), loss(-1)]);
    expect(s.winLossRatio).toBe(3);
    expect(s.breakevenWinRate).toBe(25);
  });

  it('breakeven sits ABOVE 50% when losses are bigger than wins', () => {
    // avgWin 1, avgLoss 3 -> ratio 0.333 -> breakeven 75%.
    const s = performanceStats([win(1), win(1), loss(-3), loss(-3)]);
    expect(s.breakevenWinRate).toBe(75);
  });

  it('breakeven is exactly 50% only when wins and losses are the same size', () => {
    const s = performanceStats([win(2), loss(-2)]);
    expect(s.breakevenWinRate).toBe(50);
  });

  it('a 30% win rate can beat its own breakeven', () => {
    // 3 wins of +4, 7 losses of -1. Win rate 30%, breakeven 20%.
    const closed = [...Array(3).fill(win(4)), ...Array(7).fill(loss(-1))];
    const s = performanceStats(closed);
    expect(s.winRate).toBe(30);
    expect(s.breakevenWinRate).toBe(20);
    expect(s.winRate).toBeGreaterThan(s.breakevenWinRate!);
    expect(s.expectancyPct).toBeGreaterThan(0);
  });

  it('expectancy is the realised mean, and reports losses as a positive magnitude', () => {
    const s = performanceStats([win(4), loss(-1)]);
    expect(s.expectancyPct).toBe(1.5);
    expect(s.avgLossPct).toBe(1);
  });

  it('flags a result inconclusive when the confidence interval spans zero', () => {
    // Wildly mixed outcomes: the mean is near zero and the interval is wide.
    const s = performanceStats([win(5), loss(-5), win(4), loss(-4)]);
    expect(s.expectancyCi95!.low).toBeLessThan(0);
    expect(s.expectancyCi95!.high).toBeGreaterThan(0);
    expect(s.inconclusive).toBe(true);
  });

  it('does not flag inconclusive when the interval is entirely one side of zero', () => {
    const s = performanceStats(Array(40).fill(win(2)));
    expect(s.expectancyCi95!.low).toBeGreaterThan(0);
    expect(s.inconclusive).toBe(false);
  });

  it('a single trade is never conclusive', () => {
    const s = performanceStats([win(10)]);
    expect(s.sampleSize).toBe(1);
    expect(s.expectancyCi95).toBeNull();
    expect(s.inconclusive).toBe(true);
  });

  it('an empty set reports no breakeven rather than a fabricated one', () => {
    const s = performanceStats([]);
    expect(s.sampleSize).toBe(0);
    expect(s.breakevenWinRate).toBeNull();
    expect(s.inconclusive).toBe(true);
  });

  it('all-wins has no loss to divide by, so no breakeven is claimed', () => {
    const s = performanceStats([win(1), win(2)]);
    expect(s.winLossRatio).toBeNull();
    expect(s.breakevenWinRate).toBeNull();
  });
});

describe('isDuplicateSetup', () => {
  const t = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
  const sig = (over: Partial<DedupeCandidate> = {}): DedupeCandidate => ({
    symbol: 'RELIANCE', direction: 'BUY', entryPrice: 1000, generatedAt: t(0), ...over,
  });

  it('suppresses the same setup regenerated 15 minutes later', () => {
    // The actual failure: the screener re-runs every 15 min, so a two-hour
    // trend produced ~8 rows that were each scored as an independent trade.
    expect(isDuplicateSetup(sig(), [sig({ generatedAt: t(15), entryPrice: 1002 })])).toBe(true);
  });

  it('keeps a signal on the same symbol in the OPPOSITE direction', () => {
    // A reversal is genuinely new information, not a restatement.
    expect(isDuplicateSetup(sig(), [sig({ direction: 'SELL', generatedAt: t(15) })])).toBe(false);
  });

  it('keeps a signal at a materially different entry', () => {
    // 1000 -> 1200 is a different setup even on the same symbol and side.
    expect(isDuplicateSetup(sig(), [sig({ entryPrice: 1200, generatedAt: t(15) })])).toBe(false);
  });

  it('keeps a signal once the window has passed', () => {
    expect(isDuplicateSetup(sig(), [sig({ generatedAt: t(5 * 60) })])).toBe(false);
  });

  it('keeps a signal on a different symbol at the same price', () => {
    expect(isDuplicateSetup(sig(), [sig({ symbol: 'TCS', generatedAt: t(15) })])).toBe(false);
  });

  it('treats an out-of-order arrival as the same idea', () => {
    // Absolute time difference — clock skew between services must not defeat it.
    expect(isDuplicateSetup(sig({ generatedAt: t(30) }), [sig({ generatedAt: t(15) })])).toBe(true);
  });

  it('stores the first signal when nothing precedes it', () => {
    expect(isDuplicateSetup(sig(), [])).toBe(false);
  });

  it('never suppresses on unusable input', () => {
    // Losing a real signal is worse than storing a duplicate, so bad data fails
    // open rather than silently dropping the message.
    expect(isDuplicateSetup(sig({ entryPrice: 0 }), [sig()])).toBe(false);
    expect(isDuplicateSetup(sig({ generatedAt: 'nonsense' }), [sig()])).toBe(false);
    expect(isDuplicateSetup(sig(), [sig({ generatedAt: 'nonsense' })])).toBe(false);
  });

  it('respects the tolerance boundary', () => {
    // 0.5% default: 1005 is in, 1006 is out.
    expect(isDuplicateSetup(sig(), [sig({ entryPrice: 1005, generatedAt: t(15) })])).toBe(true);
    expect(isDuplicateSetup(sig(), [sig({ entryPrice: 1006, generatedAt: t(15) })])).toBe(false);
  });
});
