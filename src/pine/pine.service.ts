import { Injectable } from '@nestjs/common';
import { UpstreamHttpClient } from '../common/http/upstream-http.client';
import { RunPineDto } from './dto/run-pine.dto';

export interface PineRunResult {
  ok: boolean;
  plots: Record<string, number[]> | null;
  strategy: unknown;
  error: string | null;
}

/**
 * ai-trader-signals owns the sandbox subprocess (isolated worker_threads
 * Worker, timeout + memory caps) -- this is a thin proxy, matching how every
 * other cross-service computation already flows through UpstreamHttpClient
 * (see MarketService, SignalsUpstreamClient).
 */
@Injectable()
export class PineService {
  constructor(private readonly http: UpstreamHttpClient) {}

  run(dto: RunPineDto): Promise<PineRunResult> {
    return this.http.request<PineRunResult>('/signals/pine/run', {
      method: 'POST',
      body: {
        source: dto.source,
        bars: dto.bars,
        mode: dto.mode ?? 'indicator',
        symbol: dto.symbol,
        exchange: dto.exchange,
        interval: dto.interval,
      },
      // Pine execution has its own timeout inside the sandbox (5s default);
      // this just needs to outlast that plus subprocess spin-up overhead.
      timeoutMs: 10_000,
    });
  }
}
