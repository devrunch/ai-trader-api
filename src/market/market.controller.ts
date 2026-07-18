import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('market')
export class MarketController {
  private readonly signalsUrl: string;

  constructor(private readonly config: ConfigService) {
    this.signalsUrl =
      this.config.get<string>('SIGNALS_SERVICE_URL') ?? 'http://localhost:8001';
  }

  private async proxy(path: string): Promise<unknown> {
    const res = await fetch(`${this.signalsUrl}${path}`);
    if (!res.ok) throw new Error(`Upstream ${res.status}: ${path}`);
    return res.json();
  }

  @Get('status')
  status() {
    return this.proxy('/market/status');
  }

  @Get('news')
  news(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
  ) {
    const params = new URLSearchParams();
    if (symbols) params.set('symbols', symbols);
    if (limit)   params.set('limit', limit);
    const qs = params.toString();
    return this.proxy(`/market/news${qs ? `?${qs}` : ''}`);
  }

  @Get('quote/:symbol')
  quote(
    @Param('symbol') symbol: string,
    @Query('exchange') exchange = 'NSE',
  ) {
    return this.proxy(`/market/quote/${symbol}?exchange=${exchange}`);
  }

  @Get('historical/:symbol')
  historical(
    @Param('symbol') symbol: string,
    @Query('exchange') exchange = 'NSE',
    @Query('interval') interval = '15m',
    @Query('days') days = '30',
  ) {
    return this.proxy(
      `/market/historical/${symbol}?exchange=${exchange}&interval=${interval}&days=${days}`,
    );
  }
}
