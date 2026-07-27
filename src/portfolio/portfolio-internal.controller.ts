import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  PaperTradingService,
  PortfolioView,
  RiskState,
  SquareOffResult,
} from './paper-trading.service';
import { WatchlistService } from '../watchlist/watchlist.service';
import { Exchange } from './schemas/paper-portfolio.schema';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';

/**
 * Internal, service-to-service only — consumed by the Python signals service so
 * the chat agent can reason about the user's actual portfolio.
 *
 * Unlike the watchlist internal endpoint (which serves a non-sensitive union),
 * this returns per-user financial data, so it additionally requires a shared
 * secret header. It must never be exposed outside the private Docker network.
 */
@SkipThrottle()
@UseGuards(InternalKeyGuard)
@Controller('internal/trading-context')
export class PortfolioInternalController {
  constructor(
    private readonly paperTrading: PaperTradingService,
    private readonly watchlist: WatchlistService,
  ) {}

  @Get(':userId')
  async context(@Param('userId') userId: string) {
    // A failure in any one section degrades that section only — the chat agent
    // can still reason about whatever is available.
    const orEmpty = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);

    const [summary, positions, orders, trades, watchlist, risk] = await Promise.all([
      this.paperTrading
        .getPortfolio(userId, Exchange.NSE)
        .catch((): PortfolioView | null => null),
      orEmpty(this.paperTrading.getPositions(userId)),
      orEmpty(this.paperTrading.getOrders(userId, 20)),
      orEmpty(this.paperTrading.getTrades(userId, 50)),
      orEmpty(this.watchlist.list(userId)),
      // The agent needs to know what the account is *allowed* to do, or it goes
      // on proposing trades that placement will refuse.
      this.paperTrading
        .getRiskState(userId, Exchange.NSE)
        .catch((): RiskState | null => null),
    ]);

    return {
      portfolio: summary
        ? {
            cashBalance: summary.cashBalance,
            initialCapital: summary.initialCapital,
            totalValue: summary.totalValue,
            realisedPnl: summary.realisedPnl,
            unrealisedPnl: summary.unrealisedPnl,
            // Position sizing scales off totalValue, so the agent must be able
            // to tell whether that number is current. Nothing refreshes marks
            // on a schedule.
            marksAsOf: summary.marksAsOf,
            marksStale: summary.marksStale,
            totalPnl: summary.totalPnl,
          }
        : null,
      riskState: risk,
      positions: positions.map((p) => ({
        symbol: p.symbol,
        exchange: p.exchange,
        quantity: p.quantity,
        averageCost: p.averageCost,
        currentPrice: p.currentPrice,
        unrealisedPnl: p.unrealisedPnl,
        stopLoss: p.stopLoss ?? null,
      })),
      openOrders: orders
        .filter((o) => o.status === 'PENDING')
        .map((o) => ({
          symbol: o.symbol,
          side: o.side,
          quantity: o.quantity,
          type: o.type,
          limitPrice: o.limitPrice,
        })),
      watchlist: watchlist.map((w) => ({
        symbol: w.symbol,
        exchange: w.exchange,
      })),
      recentTrades: trades.slice(0, 50).map((t) => ({
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        realisedPnl: t.realisedPnl,
        executedAt: t.executedAt,
      })),
    };
  }
}

/**
 * Internal, service-to-service only — the 15:20 IST square-off trigger.
 *
 * The trading calendar lives in the Python signals service (holidays included)
 * and Celery beat is what has a scheduler, so the schedule lives there and the
 * execution lives here, where the positions and the order engine are. This
 * endpoint flattens every open position for every user, so it is behind the
 * shared internal secret and must never be exposed outside the private network.
 */
@SkipThrottle()
@UseGuards(InternalKeyGuard)
@Controller('internal/paper')
export class PaperSquareOffController {
  constructor(private readonly paperTrading: PaperTradingService) {}

  @Post('square-off')
  squareOff(): Promise<SquareOffResult> {
    return this.paperTrading.squareOffAll();
  }
}
