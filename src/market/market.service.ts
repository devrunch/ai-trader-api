import { Injectable } from '@nestjs/common';
import { UpstreamHttpClient } from '../common/http/upstream-http.client';

/**
 * Upstream transport for the market-data proxy routes.
 *
 * `MarketModule` previously had a controller and no service, so the controller
 * owned validation, URL construction, transport and error translation at once —
 * leaving nowhere to add a timeout, a cache or a retry.
 */
@Injectable()
export class MarketService {
  constructor(private readonly http: UpstreamHttpClient) {}

  status(): Promise<unknown> {
    return this.http.request('/market/status');
  }

  news(params: URLSearchParams): Promise<unknown> {
    return this.http.request('/market/news', { params });
  }

  search(params: URLSearchParams): Promise<unknown> {
    return this.http.request('/market/search', { params });
  }

  quote(symbol: string, params: URLSearchParams): Promise<unknown> {
    return this.http.request(
      `/market/quote/${encodeURIComponent(symbol)}`,
      { params },
    );
  }

  historical(symbol: string, params: URLSearchParams): Promise<unknown> {
    return this.http.request(
      `/market/historical/${encodeURIComponent(symbol)}`,
      { params },
    );
  }

  /**
   * Live tick-count volume for the chart's still-forming candle. Polled by
   * the terminal every few seconds while a FOREX/metals chart is open, so a
   * tight timeout matters more here than the 10s default -- a slow answer
   * should just be skipped until the next poll, not held open.
   */
  tickVolume(symbol: string, params: URLSearchParams): Promise<unknown> {
    return this.http.request(
      `/market/tick-volume/${encodeURIComponent(symbol)}`,
      { params, timeoutMs: 5_000 },
    );
  }

  /**
   * Last traded price for one symbol. Used by the paper-trading order path,
   * which wants a tighter budget than the 10s default: a user waiting on a fill
   * should get a fast failure, not a ten-second hang.
   */
  async ltp(symbol: string, exchange: string): Promise<number> {
    const params = new URLSearchParams({ exchange });
    const res = await this.http.request<{ ltp?: number }>(
      `/market/quote/${encodeURIComponent(symbol)}`,
      { params, timeoutMs: 5_000 },
    );
    const ltp = res?.ltp;
    if (!ltp) throw new Error('Empty LTP');
    return ltp;
  }
}
