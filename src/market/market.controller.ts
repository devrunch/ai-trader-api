import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MarketService } from './market.service';

/* ── Allowlists ── */
const SYMBOL_RE   = /^[A-Z0-9^._-]{1,20}$/;          // NSE tickers, indices (^NSEI), forex pairs
const EXCHANGES   = new Set(['NSE', 'BSE', 'FOREX']);
const INTERVALS   = new Set(['1m', '5m', '15m', '1h', '1d']);
const MAX_DAYS    = 1825;                              // 5 years
const MAX_LIMIT   = 30;

function validSymbol(s: string): string {
  const u = s.trim().toUpperCase();
  if (!SYMBOL_RE.test(u)) throw new BadRequestException(`Invalid symbol: ${s}`);
  return u;
}

function validExchange(e: string): string {
  const u = e.trim().toUpperCase();
  if (!EXCHANGES.has(u)) throw new BadRequestException(`Invalid exchange: ${e}`);
  return u;
}

function validInterval(i: string): string {
  if (!INTERVALS.has(i)) throw new BadRequestException(`Invalid interval: ${i}`);
  return i;
}

function validDays(d: string | number): number {
  const n = typeof d === 'number' ? d : parseInt(String(d), 10);
  if (!Number.isFinite(n) || n < 1 || n > MAX_DAYS)
    throw new BadRequestException(`days must be 1–${MAX_DAYS}`);
  return n;
}

function validLimit(l: string | number): number {
  const n = typeof l === 'number' ? l : parseInt(String(l), 10);
  if (!Number.isFinite(n) || n < 1 || n > MAX_LIMIT)
    throw new BadRequestException(`limit must be 1–${MAX_LIMIT}`);
  return n;
}

function validSymbolList(csv: string): string[] {
  return csv.split(',').map(s => validSymbol(s));
}

/**
 * Validation only. Transport, timeouts, retries and upstream status mapping
 * live in `MarketService` / `UpstreamHttpClient`.
 */
@UseGuards(JwtAuthGuard)
@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get('status')
  status() {
    return this.market.status();
  }

  @Get('news')
  news(
    @Query('symbols') symbols?: string,
    @Query('limit')   limit = '15',
  ) {
    const params = new URLSearchParams();
    if (symbols) {
      const validated = validSymbolList(symbols).join(',');
      params.set('symbols', validated);
    }
    params.set('limit', String(validLimit(limit)));
    return this.market.news(params);
  }

  @Get('quote/:symbol')
  quote(
    @Param('symbol')   symbol: string,
    @Query('exchange') exchange = 'NSE',
  ) {
    const params = new URLSearchParams();
    params.set('exchange', validExchange(exchange));
    return this.market.quote(validSymbol(symbol), params);
  }

  @Get('historical/:symbol')
  historical(
    @Param('symbol')   symbol: string,
    @Query('exchange') exchange  = 'NSE',
    @Query('interval') interval  = '15m',
    @Query('days')     days      = '30',
  ) {
    const params = new URLSearchParams();
    params.set('exchange', validExchange(exchange));
    params.set('interval', validInterval(interval));
    params.set('days',     String(validDays(days)));
    return this.market.historical(validSymbol(symbol), params);
  }
}
