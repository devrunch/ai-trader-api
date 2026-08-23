import { SYMBOL_RE } from './symbol';

describe('SYMBOL_RE', () => {
  it('accepts every non-alphanumeric character a real reachable symbol uses', () => {
    // One real example per character, taken from a live Kite instrument
    // dump (see symbol.ts's own comment for the full provenance) — not
    // invented cases.
    expect(SYMBOL_RE.test('NIFTY 50')).toBe(true); // space
    expect(SYMBOL_RE.test('NIFTY BANK')).toBe(true); // space
    expect(SYMBOL_RE.test('ARE&M')).toBe(true); // & -- a real equity ticker
    expect(SYMBOL_RE.test('BSE CAPITAL MKTS & INSURANCE')).toBe(true); // & + space, 28 chars
    expect(SYMBOL_RE.test('HANGSENG BEES-NAV')).toBe(true); // -
    expect(SYMBOL_RE.test('SUNDRMBRAK-BE')).toBe(true); // - (SME/series suffix)
    expect(SYMBOL_RE.test('8.9JSWSL30')).toBe(true); // .
    expect(SYMBOL_RE.test('BSE SENSEX SIXTY 65:35')).toBe(true); // :
    expect(SYMBOL_RE.test('^NSEI')).toBe(true); // ^ -- yfinance's index convention, a different provider
    expect(SYMBOL_RE.test('^BSESN')).toBe(true);
    expect(SYMBOL_RE.test('GOLD1!')).toBe(true); // ! -- MCX continuous-contract convention (TradingView's own)
  });

  it('accepts every real symbol length, up to the longest one seen live', () => {
    // "BSE CAPITAL MKTS & INSURANCE" (28 chars) is the longest real
    // reachable symbol as of the scan symbol.ts documents -- the old {1,20}
    // cap rejected it and several other real index names outright.
    expect(SYMBOL_RE.test('BSE CAPITAL MKTS & INSURANCE')).toBe(true);
    expect('BSE CAPITAL MKTS & INSURANCE'.length).toBe(28);
    expect(SYMBOL_RE.test('A'.repeat(40))).toBe(true);
  });

  it('still rejects empty input, oversized input, and non-symbol junk', () => {
    expect(SYMBOL_RE.test('')).toBe(false);
    expect(SYMBOL_RE.test('A'.repeat(41))).toBe(false);
    expect(SYMBOL_RE.test('DROP TABLE;')).toBe(false); // ; is not a real symbol character
    expect(SYMBOL_RE.test('<script>')).toBe(false);
    expect(SYMBOL_RE.test('a/b')).toBe(false); // / is not a real symbol character
  });
});
