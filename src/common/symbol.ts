/**
 * What a valid tradable symbol string can look like — derived from the real
 * Kite instrument list, not guessed. The 4 places that used to each declare
 * their own copy of this regex were each hand-guessed once ("letters,
 * numbers, maybe a dot or dash") and never checked against real data, so
 * every symbol outside that guess 400'd the first time a user searched for
 * it — NIFTY 50 and NIFTY BANK (space), then ARE&M (a real, currently-listed
 * equity with an ampersand), and it would have kept happening one symbol at
 * a time. This is the actual character/length inventory of every symbol
 * `_ensure_instruments()`'s filter can ever hand back (dumped live from
 * Kite's real NSE+BSE instrument list on 2026-08-18, 22,948 rows):
 *
 *   ' ' -> "NIFTY 50", "NIFTY BANK", "BSE SENSEX SIXTY"
 *   '&' -> "ARE&M" (equity), "BSE CAPITAL MKTS & INSURANCE" (index)
 *   '-' -> "HANGSENG BEES-NAV", and every "-BE"/"-SM"/"-ST"/"-N0"/etc.
 *          series-suffixed ticker (SME/bond/ETF series codes)
 *   '.' -> "8.9JSWSL30" (a bond's coupon rate embedded in its own symbol)
 *   ':' -> "BSE SENSEX SIXTY 65:35"
 *
 * Longest real reachable symbol: "BSE CAPITAL MKTS & INSURANCE" (28 chars).
 * The old {1,20} cap rejected it and 5 other real index names outright,
 * regardless of character class. Capped at 40 here, not the exact 28,
 * for headroom — Kite adds new index variants over time (the "NIFTY ..."
 * list alone is >150 names and still growing), and re-deriving this exact
 * bound every time one crosses 28 chars is the same mistake in miniature.
 *
 * `^` is NOT a real Kite tradingsymbol character (confirmed absent from the
 * live scan above) — it's kept for the yfinance fallback provider's own
 * index convention (^NSEI, ^BSESN), a different data source with a
 * different symbol format that also flows through this same validation.
 *
 * `!` is also not a real Kite tradingsymbol character — it's the marker for
 * an MCX continuous-contract symbol ("GOLD1!"), TradingView's own
 * convention (confirmed live against tradingview.com) for "whichever real
 * dated contract is currently front-month", adopted rather than invented
 * (see kite_provider.py's own _CONTINUOUS_SUFFIX). This synthetic symbol
 * never reaches Kite's real API directly — KiteProvider resolves it to a
 * real tradingsymbol first — but it still has to pass this shared
 * validation on the way in.
 *
 * Re-verify this against a fresh instrument dump if a new symbol 400s here
 * again — that means the real data grew a character or length this
 * inventory doesn't cover yet, not that the symbol is actually invalid.
 */
export const SYMBOL_RE = /^[A-Z0-9^&:.! -]{1,40}$/;
