import { Injectable } from '@nestjs/common';
import { UpstreamHttpClient } from '../common/http/upstream-http.client';
import { RunPineDto } from './dto/run-pine.dto';

/** One `input.*()` declaration parsed straight out of the script by
 *  PineTS's own Indicator class (getInputsMeta()) -- real metadata, not
 *  something this app infers from the source text. Mirrors PineTS's
 *  IPineInput; only the fields this app currently renders a form from are
 *  listed here, everything else still round-trips through as `unknown`
 *  extras since callers only destructure named fields. */
export interface PineInputMeta {
  type: string;
  defval: unknown;
  varId?: string;
  title?: string;
  minval?: number;
  maxval?: number;
  step?: number;
  options?: unknown[];
}

export interface PineRunResult {
  ok: boolean;
  plots: Record<string, number[]> | null;
  strategy: unknown;
  error: string | null;
  inputsMeta?: PineInputMeta[];
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
        inputOverrides: dto.inputOverrides,
      },
      // Pine execution has its own timeout inside the sandbox (5s default);
      // this just needs to outlast that plus subprocess spin-up overhead.
      timeoutMs: 10_000,
    });
  }
}
