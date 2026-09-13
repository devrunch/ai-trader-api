import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';
import { StoreSignalDto } from './dto/store-signal.dto';
import { SignalsService } from './signals.service';

/**
 * Internal, service-to-service only — the Python signals service posts each
 * generated signal here. Shared-secret gated; never expose publicly.
 */
@SkipThrottle()
@UseGuards(InternalKeyGuard)
@Controller('internal/signals')
export class SignalsInternalController {
  constructor(private readonly signals: SignalsService) {}

  @Post()
  async store(@Body() payload: StoreSignalDto) {
    const saved = await this.signals.persistSignal(payload);
    return { ok: true, saved: saved !== null };
  }
}
