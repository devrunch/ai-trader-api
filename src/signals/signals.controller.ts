import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SignalsService } from './signals.service';

@UseGuards(JwtAuthGuard)
@Controller('signals')
export class SignalsController {
  constructor(private readonly signalsService: SignalsService) {}

  @Get()
  getRecent(@Query('limit') limit?: string) {
    return this.signalsService.getRecentSignals(limit ? parseInt(limit) : 50);
  }

  @Get(':symbol')
  getBySymbol(@Param('symbol') symbol: string, @Query('limit') limit?: string) {
    return this.signalsService.getSignalsBySymbol(symbol, limit ? parseInt(limit) : 20);
  }
}
