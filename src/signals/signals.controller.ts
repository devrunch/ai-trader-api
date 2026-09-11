import { BadRequestException, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SignalsService } from './signals.service';
import { SignalsUpstreamClient } from './signals-upstream.client';
import { SYMBOL_RE } from './chat-request';

// Narrower than the chat/market EXCHANGES: on-demand signal generation runs
// its own validation and cost model (validation.py, cost_pct_round_trip) built
// and tuned for NSE intraday equity. Widening EXCHANGES for chat/quotes must
// not silently widen this too — a "signal" for a NASDAQ symbol would apply
// Indian brokerage costs and risk assumptions to a market they were never
// measured against.
const SIGNAL_EXCHANGES = new Set(['NSE', 'BSE']);

@UseGuards(JwtAuthGuard)
@Controller('signals')
export class SignalsController {
  constructor(
    private readonly signalsService: SignalsService,
    private readonly upstream: SignalsUpstreamClient,
  ) {}

  @Get()
  getRecent(@Query('limit') limit?: string) {
    return this.signalsService.getRecentSignals(limit ? parseInt(limit) : 50);
  }

  // On-demand signal generation — triggers the FastAPI service synchronously
  // instead of waiting for the next 15-min screener run.
  // Tightly throttled: each call costs real Bedrock tokens and pins a signals
  // worker for tens of seconds.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('generate/:symbol')
  async generate(@Param('symbol') symbol: string, @Query('exchange') exchange = 'NSE') {
    const sym  = symbol.trim().toUpperCase();
    const exch = exchange.trim().toUpperCase();
    if (!SYMBOL_RE.test(sym)) throw new BadRequestException(`Invalid symbol: ${symbol}`);
    if (!SIGNAL_EXCHANGES.has(exch)) {
      throw new BadRequestException(
        `Signal generation is available for NSE and BSE only right now: ${exchange}`,
      );
    }

    return this.upstream.generate(sym, exch);
  }

  // Backtest stored signals against historical price data (must precede :symbol).
  @Get('performance')
  performance(@Query('limit') limit?: string) {
    return this.signalsService.evaluatePerformance(limit ? parseInt(limit) : 40);
  }

  @Get(':symbol')
  getBySymbol(@Param('symbol') symbol: string, @Query('limit') limit?: string) {
    return this.signalsService.getSignalsBySymbol(symbol, limit ? parseInt(limit) : 20);
  }
}
