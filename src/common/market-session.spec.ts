import { sessionStart } from './market-session';

/**
 * 09:15 IST is 03:45 UTC. Every expectation below is written in UTC so the
 * suite gives the same answer wherever it runs — the bug this module exists to
 * avoid is a "daily" limit that resets at the developer's local midnight.
 */
describe('sessionStart', () => {
  it('returns today 09:15 IST once the session has opened', () => {
    // 2026-03-10 11:00 IST == 05:30 UTC
    const now = new Date('2026-03-10T05:30:00Z');
    expect(sessionStart(now).toISOString()).toBe('2026-03-10T03:45:00.000Z');
  });

  it('returns yesterday 09:15 IST before today has opened', () => {
    // 2026-03-10 08:00 IST == 02:30 UTC, before the 09:15 open
    const now = new Date('2026-03-10T02:30:00Z');
    expect(sessionStart(now).toISOString()).toBe('2026-03-09T03:45:00.000Z');
  });

  it('treats the exact open as inside the new session', () => {
    const now = new Date('2026-03-10T03:45:00Z');
    expect(sessionStart(now).toISOString()).toBe('2026-03-10T03:45:00.000Z');
  });

  it('rolls over on the IST day boundary, not the UTC one', () => {
    // 2026-03-10 23:00 UTC is already 2026-03-11 04:30 IST, but that is before
    // the 11th's 09:15 open — so the last session to have started is the 10th's.
    // A naive UTC-day implementation would answer the 10th here for the wrong
    // reason and the 11th an hour later, when nothing had opened.
    expect(sessionStart(new Date('2026-03-10T23:00:00Z')).toISOString()).toBe(
      '2026-03-10T03:45:00.000Z',
    );

    // 2026-03-11 04:00 UTC == 09:30 IST — the 11th's session is now under way.
    expect(sessionStart(new Date('2026-03-11T04:00:00Z')).toISOString()).toBe(
      '2026-03-11T03:45:00.000Z',
    );
  });
});
