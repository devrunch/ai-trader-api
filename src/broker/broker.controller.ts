import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';
import { ZerodhaSessionService } from './zerodha-session.service';

/**
 * Internal, service-to-service only — the Python signals service's daily
 * refresh task writes here, and its KiteProvider reads here before every
 * Kite call. Never exposed outside the private Docker network.
 */
@SkipThrottle()
@UseGuards(InternalKeyGuard)
@Controller('internal/broker/zerodha')
export class BrokerController {
  constructor(private readonly sessions: ZerodhaSessionService) {}

  @Get('session')
  get() {
    return this.sessions.get();
  }

  @Put('session')
  set(@Body('accessToken') accessToken: string) {
    return this.sessions.set(accessToken);
  }
}
