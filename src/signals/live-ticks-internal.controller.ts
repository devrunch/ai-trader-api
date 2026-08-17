import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';
import { SignalsGateway } from './signals.gateway';

/**
 * Internal, service-to-service only — the Python signals service calls
 * this once on startup to learn which symbols already have watchers, so a
 * process restart (every deploy) doesn't silently stop live ticks for
 * anyone already watching.
 */
@SkipThrottle()
@UseGuards(InternalKeyGuard)
@Controller('internal/market')
export class LiveTicksInternalController {
  constructor(private readonly gateway: SignalsGateway) {}

  @Get('active-symbols')
  activeSymbols() {
    return this.gateway.getActiveSymbols();
  }
}
