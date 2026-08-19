import { BadRequestException, Body, Controller, Get, Logger, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatBudgetService } from '../chat/chat-budget.service';
import { ChatSessionsService, UpstreamTurn } from '../chat/chat-sessions.service';
import { SignalsService } from './signals.service';
import { SignalsUpstreamClient } from './signals-upstream.client';
import { ChatDto } from './dto/chat.dto';
import { SYMBOL_RE, normaliseChatRequest } from './chat-request';

// Narrower than the chat/market EXCHANGES: on-demand signal generation runs
// its own validation and cost model (validation.py, cost_pct_round_trip) built
// and tuned for NSE intraday equity. Widening EXCHANGES for chat/quotes must
// not silently widen this too — a "signal" for a NASDAQ symbol would apply
// Indian brokerage costs and risk assumptions to a market they were never
// measured against.
const SIGNAL_EXCHANGES = new Set(['NSE', 'BSE']);

interface AuthRequest extends Request {
  user: { id: string; email: string; plan: string };
}

@UseGuards(JwtAuthGuard)
@Controller('signals')
export class SignalsController {
  private readonly logger = new Logger(SignalsController.name);

  constructor(
    private readonly signalsService: SignalsService,
    private readonly upstream: SignalsUpstreamClient,
    private readonly chatSessions: ChatSessionsService,
    private readonly chatBudget: ChatBudgetService,
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

  // Conversational analysis agent — proxied to the FastAPI signals service.
  // One turn can run up to 6 LLM round-trips, each of which may fetch market
  // data, so this is the most expensive endpoint in the product.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('chat')
  async chat(@Req() req: AuthRequest, @Body() body: ChatDto) {
    const { symbol, exchange, message, history } = normaliseChatRequest(body);

    // Before the turn, not after: the cost is incurred upstream the moment the
    // request is made. The rate limiter bounds requests per minute, which is a
    // different thing from what a day of them costs.
    await this.chatBudget.assertWithinBudget(req.user.id);

    // userId comes from the verified JWT, never from the request body —
    // the agent's portfolio access is scoped to the authenticated user only.
    const result = (await this.upstream.chat({
      symbol,
      exchange,
      message,
      history,
      user_id: req.user.id,
    })) as UpstreamTurn;

    // Recording must never cost the user their answer: the turn has already
    // been paid for, and a failed write is our problem, not theirs.
    let turnId: string | undefined;
    try {
      const stored = await this.chatSessions.recordTurn(req.user.id, message, result, {
        forceNewSession: body.newSession,
      });
      turnId = stored?.turnId;
    } catch (err) {
      this.logger.error(
        `Failed to record chat turn for ${symbol}: ${(err as Error)?.message}`,
      );
    }

    return { ...result, turnId };
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
