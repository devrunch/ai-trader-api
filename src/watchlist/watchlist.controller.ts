import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WatchlistService } from './watchlist.service';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';

interface AuthRequest extends Request {
  user: { id: string; email: string; plan: string };
}

@UseGuards(JwtAuthGuard)
@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Get()
  list(@Req() req: AuthRequest) {
    return this.watchlist.list(req.user.id);
  }

  @Post()
  add(@Req() req: AuthRequest, @Body() dto: { symbol: string; exchange?: string }) {
    return this.watchlist.add(req.user.id, dto.symbol, dto.exchange);
  }

  @Delete(':symbol')
  remove(@Req() req: AuthRequest, @Param('symbol') symbol: string, @Query('exchange') exchange?: string) {
    return this.watchlist.remove(req.user.id, symbol, exchange);
  }
}

/**
 * Internal, service-to-service only. Network isolation alone is NOT sufficient —
 * the serverless deployment routes /api/{proxy+} publicly, which would expose
 * this. Gated by the same shared secret as the other internal controllers.
 */
@SkipThrottle()
@UseGuards(InternalKeyGuard)
@Controller('internal/watchlist')
export class WatchlistInternalController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Get()
  compiledUnion() {
    return this.watchlist.compiledUnion();
  }
}
