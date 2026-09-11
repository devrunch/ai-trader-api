import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BriefService } from './brief.service';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';
import { StoreBriefDto } from './dto/store-brief.dto';

@UseGuards(JwtAuthGuard)
@Controller('brief')
export class BriefController {
  constructor(private readonly brief: BriefService) {}

  @Get()
  latest() {
    return this.brief.latest();
  }

}

/**
 * Internal, service-to-service only — the Python signals service posts the
 * generated brief here. Shared-secret gated; never expose publicly.
 */
@SkipThrottle()
@UseGuards(InternalKeyGuard)
@Controller('internal/brief')
export class BriefInternalController {
  constructor(private readonly brief: BriefService) {}

  @Post()
  async store(@Body() payload: StoreBriefDto) {
    const saved = await this.brief.store(payload);
    return { ok: true, date: saved.date };
  }
}
