import { Injectable } from '@nestjs/common';
import {
  CHAT_UPSTREAM_TIMEOUT_MS,
  UpstreamHttpClient,
} from '../common/http/upstream-http.client';
import { UpstreamOutcome } from './eval';

export interface ChatUpstreamPayload {
  symbol: string;
  exchange: string;
  message: string;
  history: unknown[];
  user_id: string;
  // What SignalsGateway last heard from the browser over the chart_state
  // socket event -- lets the chat agent's chart_indicators tools see and
  // change what's actually attached. Undefined when the user hasn't
  // connected the socket this session, or their client is too old to emit
  // it; the Python side treats that as "nothing attached", not an error.
  chart_state?: { interval?: string; indicators: unknown[] };
}

/** snake_case on the wire — the signals service is Python and speaks its own convention. */
export interface EvaluateRequestSignal {
  id: string;
  symbol: string;
  exchange: string;
  direction: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  generated_at: string;
}

// Evaluating a batch fetches bars for every distinct symbol in it, so this
// legitimately takes longer than a single proxied request.
export const EVALUATE_UPSTREAM_TIMEOUT_MS = 60_000;

/**
 * Transport for the signals-service endpoints the API proxies. Controllers keep
 * validation; URL construction, timeouts, retries and status mapping live here.
 */
@Injectable()
export class SignalsUpstreamClient {
  constructor(private readonly http: UpstreamHttpClient) {}

  generate(symbol: string, exchange: string): Promise<unknown> {
    const params = new URLSearchParams({ exchange });
    return this.http.request(
      `/signals/generate/${encodeURIComponent(symbol)}`,
      { method: 'POST', params },
    );
  }

  chat(payload: ChatUpstreamPayload): Promise<unknown> {
    // 60s — one chat turn can run several LLM round-trips, each of which may
    // trigger market-data tool calls.
    return this.http.request('/signals/chat', {
      method: 'POST',
      body: payload,
      timeoutMs: CHAT_UPSTREAM_TIMEOUT_MS,
    });
  }

  /**
   * The same turn as `chat`, as a live stream of progress events.
   *
   * The buffered call stays: it is simpler for any caller that only wants the
   * answer. This one exists because a turn can legitimately run the better part
   * of a minute, and a spinner for that long is indistinguishable from a hang.
   */
  chatStream(payload: ChatUpstreamPayload, signal?: AbortSignal) {
    return this.http.stream('/signals/chat/stream', { body: payload, signal });
  }

  /**
   * Resolve stored signals against the bars that actually followed them.
   *
   * The signals service owns this logic — it has the bar-fetching path, the
   * gap-fill rule and the cost model, and maintaining the same rules in two
   * languages with no shared test vectors cannot be kept in sync by discipline.
   * This replaces a per-signal bar fetch plus a divergent local evaluator.
   */
  async evaluate(
    signals: EvaluateRequestSignal[],
    interval = '5m',
    days = 58,
  ): Promise<UpstreamOutcome[]> {
    if (!signals.length) return [];
    // Evaluating N signals is one upstream call that fetches each distinct
    // symbol's bars once, rather than N sequential round-trips from here.
    const res = await this.http.request<{ results?: UpstreamOutcome[] }>(
      '/signals/evaluate',
      {
        method: 'POST',
        body: { signals, interval, days },
        timeoutMs: EVALUATE_UPSTREAM_TIMEOUT_MS,
        // Safe to repeat: resolving signals against historical bars is a pure
        // computation. It publishes nothing and stores nothing upstream.
        retryOnNetworkError: true,
      },
    );
    return res?.results ?? [];
  }
}
