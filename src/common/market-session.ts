/**
 * NSE session boundaries, in TypeScript.
 *
 * The authoritative calendar lives in the Python service
 * (`ai-trader-signals/app/market/calendar.py`) and knows about holidays. This
 * module deliberately implements only the one thing the API needs and cannot
 * get across a service boundary on every order placement: "when did the
 * current trading session start", which is what makes a *daily* loss limit
 * daily rather than lifetime.
 *
 * IST is UTC+05:30 with no daylight saving, ever, so a fixed offset is exact —
 * no timezone database, no dependency, and no drift twice a year.
 */

/** Asia/Kolkata is a fixed +05:30. There is no DST in India. */
export const IST_OFFSET_MINUTES = 330;

/** NSE equity cash session opens at 09:15 IST. */
export const SESSION_OPEN_MINUTES = 9 * 60 + 15;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/**
 * The most recent 09:15 IST instant at or before `now`.
 *
 * Before today's open this returns *yesterday's* 09:15, which is the correct
 * conservative answer for a loss limit: it can only ever include more of the
 * user's recent losses, never fewer. Holidays and weekends need no special
 * case — no trades execute on them, so the window is simply empty.
 */
export function sessionStart(now: Date = new Date()): Date {
  const istMs = now.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE;
  const ist = new Date(istMs);
  const istMidnightMs = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate(),
  );

  let openMs = istMidnightMs + SESSION_OPEN_MINUTES * MS_PER_MINUTE;
  if (openMs > istMs) openMs -= MS_PER_DAY;

  return new Date(openMs - IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

/**
 * Midnight IST — the start of the calendar day the user is living in.
 *
 * Distinct from `sessionStart` on purpose. A trading limit resets when the
 * market opens; a spend limit resets when the user's day does, because they
 * will use the agent before the open and after the close, and being told "come
 * back tomorrow" should mean tomorrow.
 */
export function dayStart(now: Date = new Date()): Date {
  const istMs = now.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE;
  const ist = new Date(istMs);
  const istMidnightMs = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate(),
  );
  return new Date(istMidnightMs - IST_OFFSET_MINUTES * MS_PER_MINUTE);
}
