import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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
  constructor(private readonly sessions: ChatSessionsService) {}

  /** The conversation the terminal should reload for a symbol. */
  @Get('sessions/latest/:symbol')
  latestForSymbol(@Req() req: AuthRequest, @Param('symbol') symbol: string) {
    return this.sessions.getLatestForSymbol(req.user.id, symbol);
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
