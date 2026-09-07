import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';
import { AlertsService } from './alerts.service';
import { StoreAlertDto } from './dto/store-alert.dto';

@UseGuards(JwtAuthGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  recent(@Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : undefined;
    return this.alerts.recent(parsed && parsed > 0 ? Math.min(parsed, 100) : undefined);
  }
}

/**
 * Internal, service-to-service only -- the Python signals service's
 * drift-check and reddit-sentiment pipelines post here. Shared-secret
 * gated, same pattern as BriefInternalController; never expose publicly.
 */
@SkipThrottle()
@UseGuards(InternalKeyGuard)
@Controller('internal/alerts')
export class AlertsInternalController {
  constructor(private readonly alerts: AlertsService) {}

  @Post()
  async store(@Body() payload: StoreAlertDto) {
    const saved = await this.alerts.store(payload);
    return { ok: true, id: String(saved._id) };
  }
}
