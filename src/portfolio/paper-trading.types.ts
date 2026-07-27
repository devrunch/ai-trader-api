import { Exchange } from './schemas/paper-portfolio.schema';
import {
  OrderSide,
  OrderStatus,
  PaperOrderDocument,
} from './schemas/paper-order.schema';
import { PaperTradeDocument } from './schemas/paper-trade.schema';

/**
 * The shapes the paper-trading services return, and the two helpers every one
 * of them needs.
 *
 * Their own file because four services now speak these types, and a shared
 * vocabulary living inside one of them would make the other three import from
 * a sibling for no reason other than history.
 */

/** One open position as returned to callers. */
export interface PositionView {
  symbol: string;
  exchange: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  unrealisedPnl: number;
  /** Declared stop, if the opening order carried one. Nothing triggers on it. */
  stopLoss?: number;
  /** When `currentPrice` was last refreshed. Null if never marked. */
  markedAt?: Date | null;
}

/**
 * How old a mark can be before position-size advice based on it is unsafe.
 *
 * `currentPrice` updates only on an explicit refresh or the next fill, and
 * nothing calls it on a schedule — yet every sizing recommendation scales off
 * `totalValue`, which is computed from these marks. After a morning of price
 * movement the advice can be based on an account value from hours ago.
 *
 * The sizing tool already refuses to guess when the account value is MISSING
 * (an earlier version defaulted to Rs 1,00,000 and would have handed a
 * Rs 20,000 account 5x oversize). A stale value is the same failure mode, just
 * quieter — so it is reported rather than presented as current.
 */
export const MARK_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * The portfolio read model. This is the most important read in the product —
 * the chat agent sizes positions off it and the internal controller destructures
 * six fields from it — and it used to be typed `Promise<any>`.
 */
export interface PortfolioView {
  _id: unknown;
  userId: string;
  exchange: Exchange;
  initialCapital: number;
  cashBalance: number;
  totalPositionValue: number;
  realisedPnl: number;
  positions: PositionView[];
  totalValue: number;
  unrealisedPnl: number;
  totalPnl: number;
  /** Oldest position mark feeding `totalValue`. Null when there are no positions. */
  marksAsOf: Date | null;
  /** True when `totalValue` rests on a mark older than MARK_STALE_AFTER_MS. */
  marksStale: boolean;
}

/**
 * Result of a price refresh. `stale` is reported rather than swallowed: the
 * user was previously shown a stale unrealised P&L with no indication that the
 * upstream price fetch had failed.
 */
export interface RefreshPricesResult {
  positions: PositionView[];
  refreshed: number;
  stale: number;
  staleSymbols: string[];
}

/**
 * The account's current standing against every risk limit.
 *
 * Returned to the user on a blocked order and exposed to the chat agent, so it
 * stops proposing trades the account is not allowed to take. Every field is a
 * measured quantity except `openRiskIsUnbounded`, which is the honest
 * qualifier on the rest: with no STOP order type in the engine, a position's
 * downside is not actually capped by anything.
 */
export interface RiskState {
  accountValue: number;
  openPositions: number;
  maxConcurrentPositions: number;
  openRisk: number;
  openRiskPct: number;
  maxAggregateRiskPct: number;
  sessionRealisedPnl: number;
  sessionRealisedPnlPct: number;
  maxDailyLossPct: number;
  sessionStart: string;
  positionsWithoutStop: number;
  openRiskIsUnbounded: boolean;
  blocked: boolean;
  blockedReason: string | null;
}

/**
 * What `placeOrder` returns, for every order type.
 *
 * It used to return `{ order, trade }` for a MARKET order and a bare order
 * document for an unfilled LIMIT one, so a caller could not read the fill
 * without knowing which branch it had taken. The frontend consequently
 * displayed the limit price the user typed as though it were the price they
 * got. `executedPrice` is the number that actually moved the account, and it is
 * null exactly when nothing has been executed yet.
 */
export interface PlaceOrderResult {
  order: Record<string, unknown>;
  trade: Record<string, unknown> | null;
  status: OrderStatus;
  /** Price the order actually filled at. Null while the order is PENDING. */
  executedPrice: number | null;
  requestedPrice: number | null;
  quantity: number;
  symbol: string;
  side: OrderSide;
  message: string;
}

/** Outcome of the end-of-session forced flatten. */
export interface SquareOffResult {
  closed: number;
  failed: number;
  details: {
    userId: string;
    symbol: string;
    quantity: number;
    exitPrice?: number;
    error?: string;
  }[];
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Normalise what `placeOrder` hands back.
 *
 * The executed price is lifted to the top level because that — not the limit
 * price the user typed — is the number that moved the account, and the previous
 * two different return shapes made it easy to read the wrong one.
 */
export function placementResult(
  order: PaperOrderDocument,
  trade: PaperTradeDocument | null,
): PlaceOrderResult {
  const executedPrice = order.executedPrice ?? null;
  const requestedPrice = order.limitPrice ?? null;
  return {
    order: order.toObject() as Record<string, unknown>,
    trade: trade ? (trade.toObject() as Record<string, unknown>) : null,
    status: order.status,
    executedPrice,
    requestedPrice,
    quantity: order.quantity,
    symbol: order.symbol,
    side: order.side,
    message:
      executedPrice !== null
        ? `${order.side} ${order.quantity} ${order.symbol} filled at ₹${executedPrice.toFixed(2)}`
        : `${order.side} ${order.quantity} ${order.symbol} placed — not filled yet`,
  };
}
