import { IndicatorPane } from './schemas/indicator.schema';

export interface DefaultIndicator {
  id: string;
  name: string;
  category: string;
  pane: IndicatorPane;
  source: string;
}

const H = '//@version=5\n';

/**
 * The 49 built-in Pine indicators, copied verbatim from the frontend's
 * former lib/indicators/catalog.ts (now trimmed to just the two kinds that
 * aren't real Pine scripts -- Volume Profile and VSA, which stay
 * hardcoded there since a user can't author either through a Pine source
 * editor). Every source here was already validated against the running
 * PineTS sandbox with real bars before it was first added; ta.* calls are
 * pinned to the exact signatures PineTS 0.9.x ships (some, like
 * stoch/wpr/mfi, take a different argument shape than real TradingView
 * Pine).
 *
 * Seeded idempotently on every boot (see IndicatorsService.onModuleInit) --
 * upserted by `id`, never created through the API. A default's `id` must
 * never change once seeded: existing saved chart-layouts already reference
 * these exact strings (AttachedIndicator.id in chart-layout.schema.ts).
 */
export const DEFAULT_INDICATORS: DefaultIndicator[] = [
  // ── Moving Averages (main pane, overlay) ──────────────────────────
  { id: 'sma', name: 'Simple Moving Average', category: 'Moving Averages', pane: 'main',
    source: `${H}indicator("SMA")\nplot(ta.sma(close, 20), "SMA")` },
  { id: 'ema', name: 'Exponential Moving Average', category: 'Moving Averages', pane: 'main',
    source: `${H}indicator("EMA")\nplot(ta.ema(close, 20), "EMA")` },
  { id: 'wma', name: 'Weighted Moving Average', category: 'Moving Averages', pane: 'main',
    source: `${H}indicator("WMA")\nplot(ta.wma(close, 20), "WMA")` },
  { id: 'vwma', name: 'Volume Weighted Moving Average', category: 'Moving Averages', pane: 'main',
    source: `${H}indicator("VWMA")\nplot(ta.vwma(close, 20), "VWMA")` },
  { id: 'hma', name: 'Hull Moving Average', category: 'Moving Averages', pane: 'main',
    source: `${H}indicator("HMA")\nplot(ta.hma(close, 20), "HMA")` },
  { id: 'rma', name: 'Smoothed Moving Average (RMA)', category: 'Moving Averages', pane: 'main',
    source: `${H}indicator("RMA")\nplot(ta.rma(close, 20), "RMA")` },
  { id: 'alma', name: 'Arnaud Legoux Moving Average', category: 'Moving Averages', pane: 'main',
    source: `${H}indicator("ALMA")\nplot(ta.alma(close, 9, 0.85, 6), "ALMA")` },
  { id: 'vwap', name: 'VWAP', category: 'Moving Averages', pane: 'main',
    source: `${H}indicator("VWAP")\nplot(ta.vwap(close), "VWAP")` },
  { id: 'linreg', name: 'Linear Regression Curve', category: 'Moving Averages', pane: 'main',
    source: `${H}indicator("Linear Regression")\nplot(ta.linreg(close, 14, 0), "Linear Reg")` },
  { id: 'median', name: 'Moving Median', category: 'Moving Averages', pane: 'main',
    source: `${H}indicator("Median")\nplot(ta.median(close, 20), "Median")` },
  { id: 'swma', name: 'Symmetrically Weighted MA', category: 'Moving Averages', pane: 'main',
    source: `${H}indicator("SWMA")\nplot(ta.swma(close), "SWMA")` },
  { id: 'gaussian', name: 'Gaussian Filter', category: 'Moving Averages', pane: 'main',
    source: `${H}indicator("Gaussian Filter")\nlength = 9\nsigma = 3.0\nsum_w = 0.0\nsum_wv = 0.0\nfor k = 0 to length - 1\n    w = math.exp(-(k * k) / (2 * sigma * sigma))\n    sum_w += w\n    sum_wv += w * close[k]\nplot(sum_wv / sum_w, "Gaussian")` },

  // ── Trend (main pane) ──────────────────────────────────────────────
  { id: 'supertrend', name: 'Supertrend', category: 'Trend', pane: 'main',
    source: `${H}indicator("Supertrend")\n[st, dir] = ta.supertrend(3, 10)\nplot(dir < 0 ? st : na, "Supertrend Up")\nplot(dir > 0 ? st : na, "Supertrend Down")` },
  { id: 'sar', name: 'Parabolic SAR', category: 'Trend', pane: 'main',
    source: `${H}indicator("Parabolic SAR")\nplot(ta.sar(0.02, 0.02, 0.2), "SAR")` },
  { id: 'ichimoku', name: 'Ichimoku Cloud', category: 'Trend', pane: 'main',
    source: `${H}indicator("Ichimoku Cloud")\nconv = (ta.highest(high, 9) + ta.lowest(low, 9)) / 2\nbase = (ta.highest(high, 26) + ta.lowest(low, 26)) / 2\nspanA = (conv + base) / 2\nspanB = (ta.highest(high, 52) + ta.lowest(low, 52)) / 2\nplot(conv, "Conversion Line")\nplot(base, "Base Line")\nplot(spanA, "Cloud Upper")\nplot(spanB, "Cloud Lower")` },
  { id: 'dmi', name: 'DMI / ADX', category: 'Trend', pane: 'sub',
    source: `${H}indicator("DMI/ADX")\n[p, mn, adx] = ta.dmi(14, 14)\nplot(p, "+DI")\nplot(mn, "-DI")\nplot(adx, "ADX")` },
  { id: 'wavelet', name: 'Wavelet Trend', category: 'Trend', pane: 'main',
    source: `${H}indicator("Wavelet Trend")\napprox1 = (close + close[1]) / 2\napprox2 = (approx1 + approx1[2]) / 2\nplot(approx2, "Trend")` },
  { id: 'swing-high', name: 'Swing High Line', category: 'Trend', pane: 'main',
    source: `${H}indicator("Swing High")\nisSwingHigh = high == ta.highest(high, 10)\nvar float lastSwingHigh = na\nif isSwingHigh\n    lastSwingHigh := high\nplot(lastSwingHigh, "Last Swing High")` },

  // ── Volatility ─────────────────────────────────────────────────────
  { id: 'bb', name: 'Bollinger Bands', category: 'Volatility', pane: 'main',
    source: `${H}indicator("Bollinger Bands")\n[u, m, l] = ta.bb(close, 20, 2)\nplot(m, "BB Basis")\nplot(u, "BB Upper")\nplot(l, "BB Lower")` },
  { id: 'kc', name: 'Keltner Channels', category: 'Volatility', pane: 'main',
    source: `${H}indicator("Keltner Channels")\n[basis, u, l] = ta.kc(close, 20, 1.5, false)\nplot(basis, "KC Basis")\nplot(u, "KC Upper")\nplot(l, "KC Lower")` },
  { id: 'atr', name: 'Average True Range', category: 'Volatility', pane: 'sub',
    source: `${H}indicator("ATR")\nplot(ta.atr(14), "ATR")` },
  { id: 'spread', name: 'Spread', category: 'Volatility', pane: 'sub',
    source: `${H}indicator("Spread")\nplot(high - low, "Spread")` },
  { id: 'spread-on-volume', name: 'Spread (on Volume)', category: 'Volatility', pane: 'volume',
    source: `${H}indicator("Spread")\nplot(high - low, "Spread")` },
  { id: 'bbw', name: 'Bollinger Bands Width', category: 'Volatility', pane: 'sub',
    source: `${H}indicator("BBW")\nplot(ta.bbw(close, 20, 2), "BBW")` },
  { id: 'kcw', name: 'Keltner Channel Width', category: 'Volatility', pane: 'sub',
    source: `${H}indicator("KCW")\nplot(ta.kcw(close, 20, 1.5, false), "KCW")` },
  { id: 'stdev', name: 'Standard Deviation', category: 'Volatility', pane: 'sub',
    source: `${H}indicator("StdDev")\nplot(ta.stdev(close, 20), "StdDev")` },
  { id: 'donchian', name: 'Donchian Channels', category: 'Volatility', pane: 'main',
    source: `${H}indicator("Donchian Channels")\nupper = ta.highest(high, 20)\nlower = ta.lowest(low, 20)\nplot((upper + lower) / 2, "Donchian Basis")\nplot(upper, "Donchian Upper")\nplot(lower, "Donchian Lower")` },
  { id: 'envelope', name: 'Moving Average Envelope', category: 'Volatility', pane: 'main',
    source: `${H}indicator("Envelope")\nbasis = ta.sma(close, 20)\nplot(basis * 1.1, "Envelope Upper")\nplot(basis * 0.9, "Envelope Lower")` },
  { id: 'stdev-band', name: 'StdDev Band', category: 'Volatility', pane: 'main',
    source: `${H}indicator("StdDev Band")\ndev = ta.stdev(close, 20) * 2\nplot(close + dev, "StdDev Upper")\nplot(close - dev, "StdDev Lower")` },

  // ── Momentum / Oscillators (sub pane) ────────────────────────────
  { id: 'rsi', name: 'Relative Strength Index', category: 'Momentum', pane: 'sub',
    source: `${H}indicator("RSI")\nplot(ta.rsi(close, 14), "RSI")` },
  { id: 'stoch', name: 'Stochastic', category: 'Momentum', pane: 'sub',
    source: `${H}indicator("Stochastic")\nk = ta.stoch(close, high, low, 14)\nd = ta.sma(k, 3)\nplot(k, "Stoch %K")\nplot(d, "Stoch %D")` },
  { id: 'macd', name: 'MACD', category: 'Momentum', pane: 'sub',
    source: `${H}indicator("MACD")\n[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(m, "MACD")\nplot(s, "Signal")\nplot(h, "Histogram")` },
  { id: 'cci', name: 'Commodity Channel Index', category: 'Momentum', pane: 'sub',
    source: `${H}indicator("CCI")\nplot(ta.cci(close, 20), "CCI")` },
  { id: 'wpr', name: 'Williams %R', category: 'Momentum', pane: 'sub',
    source: `${H}indicator("Williams %R")\nplot(ta.wpr(14), "%R")` },
  { id: 'cmo', name: 'Chande Momentum Oscillator', category: 'Momentum', pane: 'sub',
    source: `${H}indicator("CMO")\nplot(ta.cmo(close, 14), "CMO")` },
  { id: 'tsi', name: 'True Strength Index', category: 'Momentum', pane: 'sub',
    source: `${H}indicator("TSI")\nplot(ta.tsi(close, 13, 25), "TSI")` },
  { id: 'mom', name: 'Momentum', category: 'Momentum', pane: 'sub',
    source: `${H}indicator("Momentum")\nplot(ta.mom(close, 10), "Momentum")` },
  { id: 'roc', name: 'Rate of Change', category: 'Momentum', pane: 'sub',
    source: `${H}indicator("ROC")\nplot(ta.roc(close, 10), "ROC")` },
  { id: 'ao', name: 'Awesome Oscillator', category: 'Momentum', pane: 'sub',
    source: `${H}indicator("Awesome Oscillator")\nao = ta.sma(hl2, 5) - ta.sma(hl2, 34)\nplot(ao, "Histogram")` },
  { id: 'bbp', name: 'Bollinger Bands %B', category: 'Momentum', pane: 'sub',
    source: `${H}indicator("Bollinger %B")\n[u, m, l] = ta.bb(close, 20, 2)\nplot((close - l) / (u - l), "%B")` },
  { id: 'cog', name: 'Center of Gravity', category: 'Momentum', pane: 'sub',
    source: `${H}indicator("COG")\nplot(ta.cog(close, 10), "COG")` },
  { id: 'ema-diff', name: 'EMA Diff', category: 'Momentum', pane: 'sub',
    source: `${H}indicator("EMA Diff")\nplot(ta.ema(close, 20) - ta.ema(close, 50), "EMA Diff")` },

  // ── Volume ─────────────────────────────────────────────────────────
  { id: 'mfi', name: 'Money Flow Index', category: 'Volume', pane: 'sub',
    source: `${H}indicator("MFI")\nplot(ta.mfi(hlc3, 14), "MFI")` },
  { id: 'obv', name: 'On Balance Volume', category: 'Volume', pane: 'sub',
    source: `${H}indicator("OBV")\nplot(ta.obv(), "OBV")` },
  { id: 'accdist', name: 'Accumulation / Distribution', category: 'Volume', pane: 'sub',
    source: `${H}indicator("Accum/Dist")\nplot(ta.accdist(), "A/D")` },
  { id: 'pvt', name: 'Price Volume Trend', category: 'Volume', pane: 'sub',
    source: `${H}indicator("PVT")\nplot(ta.pvt(), "PVT")` },
  { id: 'nvi', name: 'Negative Volume Index', category: 'Volume', pane: 'sub',
    source: `${H}indicator("NVI")\nplot(ta.nvi(), "NVI")` },
  { id: 'pvi', name: 'Positive Volume Index', category: 'Volume', pane: 'sub',
    source: `${H}indicator("PVI")\nplot(ta.pvi(), "PVI")` },
  { id: 'wad', name: 'Williams Accumulation/Distribution', category: 'Volume', pane: 'sub',
    source: `${H}indicator("WAD")\nplot(ta.wad(), "WAD")` },
];
