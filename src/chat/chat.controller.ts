import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatBudgetService } from './chat-budget.service';
import { ChatSessionsService } from './chat-sessions.service';

interface AuthRequest extends Request {
  user: { id: string; email: string; plan: string };
}

const parseLimit = (raw: string | undefined, fallback: number): number => {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Reading back what the agent did.
 *
 * Every route is scoped to the authenticated user inside the service, not by a
 * filter the caller supplies — an id in a URL is not proof of ownership.
 */
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private readonly sessions: ChatSessionsService,
    private readonly budget: ChatBudgetService,
  ) {}

  /**
   * Today's analysis spend.
   *
   * Exposed so the UI can warn on approach rather than only report the wall
   * after the user has hit it.
   */
  @Get('budget')
  budgetToday(@Req() req: AuthRequest) {
    return this.budget.spentToday(req.user.id);
  }

  /** The user's conversations, most recently active first. */
  @Get('sessions')
  listSessions(@Req() req: AuthRequest, @Query('limit') limit?: string) {
    return this.sessions.listSessions(req.user.id, parseLimit(limit, 30));
  }

  /**
   * The conversation the terminal should reload for a symbol.
   *
   * Declared before `sessions/:sessionId` — Nest matches routes in order, and a
   * later literal segment would otherwise be swallowed by the parameter.
   */
  @Get('sessions/latest/:symbol')
  latestForSymbol(@Req() req: AuthRequest, @Param('symbol') symbol: string) {
    return this.sessions.getLatestForSymbol(req.user.id, symbol);
  }

  /** One conversation in full, oldest turn first. */
  @Get('sessions/:sessionId')
  getSession(@Req() req: AuthRequest, @Param('sessionId') sessionId: string) {
    return this.sessions.getSession(req.user.id, sessionId);
  }

  /** One turn — the record behind "why was this trade taken". */
  @Get('turns/:turnId')
  getTurn(@Req() req: AuthRequest, @Param('turnId') turnId: string) {
    return this.sessions.getTurn(req.user.id, turnId);
  }

  /** Every backtest the agent has run, newest first. Feeds the strategies tab. */
  @Get('strategies')
  listStrategies(@Req() req: AuthRequest, @Query('limit') limit?: string) {
    return this.sessions.listStrategyRuns(req.user.id, parseLimit(limit, 50));
  }
}
