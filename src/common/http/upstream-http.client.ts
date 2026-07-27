import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';

/** 10s for ordinary market proxies. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;
/** 60s for the chat agent — one turn can run several LLM round-trips. */
export const CHAT_UPSTREAM_TIMEOUT_MS = 60_000;

export interface UpstreamRequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  params?: URLSearchParams;
  timeoutMs?: number;
  /**
   * Whether a network-level failure may be retried.
   *
   * Defaults to true for GET and false for POST. A network error means the
   * request may or may not have reached upstream — retrying a POST blindly
   * therefore risks running it twice. On `/signals/chat` that is a second full
   * LLM turn: double the cost, and the caller may receive the answer to a
   * request it believes failed.
   *
   * Set true on a POST only when the operation is genuinely repeatable — a pure
   * computation with no publish and no side effect.
   */
  retryOnNetworkError?: boolean;
}

/**
 * The single seam for every outbound call to the Python signals service.
 *
 * Before this existed, `'http://localhost:8001'` was hardcoded as a fallback in
 * four separate files, no outbound `fetch` had a timeout, and every upstream
 * failure — including a 500 — was reported to the client as `BadRequestException`
 * (400), i.e. a signals-service outage looked like the caller's fault.
 */
@Injectable()
export class UpstreamHttpClient {
  private readonly logger = new Logger(UpstreamHttpClient.name);
  readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = (
      config.get<string>('SIGNALS_SERVICE_URL') ?? 'http://localhost:8001'
    ).replace(/\/+$/, '');
  }

  async request<T>(path: string, opts: UpstreamRequestOptions = {}): Promise<T> {
    const qs = opts.params?.toString();
    const method = opts.method ?? 'GET';
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
    const mayRetry = opts.retryOnNetworkError ?? method === 'GET';

    let lastNetworkError: unknown = null;

    // At most one retry, only for network-level failures, and only when the
    // request is safe to repeat. A 4xx/5xx is a real answer from upstream —
    // retrying it just doubles the load on a service that is already unhappy.
    const attempts = mayRetry ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let res: Awaited<ReturnType<typeof fetch>>;
      try {
        res = await fetch(url, {
          method: opts.method ?? 'GET',
          headers:
            opts.body === undefined
              ? undefined
              : { 'Content-Type': 'application/json' },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastNetworkError = err;
        if (attempt === 0 && mayRetry) {
          this.logger.warn(
            `Upstream ${url} network error, retrying once: ${(err as Error)?.message}`,
          );
        }
        continue;
      }

      if (res.ok) return (await res.json()) as T;

      if (res.status === 404) {
        throw new NotFoundException(`Upstream resource not found: ${path}`);
      }
      if (res.status >= 500) {
        throw new ServiceUnavailableException(
          `Signals service unavailable (upstream ${res.status})`,
        );
      }
      throw new BadRequestException(`Upstream ${res.status}`);
    }

    throw new ServiceUnavailableException(
      `Signals service unreachable: ${(lastNetworkError as Error)?.message ?? 'network error'}`,
    );
  }

  /**
   * Open a streaming response and hand back the body, unread.
   *
   * `request` ends in `await res.json()` — it waits for a complete body, which
   * is exactly what a stream does not have. This is the same call without that
   * step, so the caller can forward chunks as they arrive.
   *
   * Never retried: a stream that failed part-way has already delivered events
   * to the client, and replaying it would repeat them. There is also no
   * `AbortSignal.timeout` on the whole response — the point of the stream is
   * that it outlives a normal request budget — so cancellation is the caller's
   * job, driven by the client hanging up.
   */
  async stream(
    path: string,
    opts: { body?: unknown; signal?: AbortSignal } = {},
  ): Promise<Readable> {
    const url = `${this.baseUrl}${path}`;
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(opts.body ?? {}),
        signal: opts.signal,
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Signals service unreachable: ${(err as Error)?.message ?? 'network error'}`,
      );
    }

    if (!res.ok || !res.body) {
      throw new ServiceUnavailableException(
        `Signals service could not start the stream (upstream ${res.status})`,
      );
    }

    // `fetch` hands back a WEB ReadableStream, which has no `.on()`. Converting
    // is not a formality: an earlier version cast it to a Node stream to satisfy
    // the compiler, which type-checked, passed every unit test, and threw
    // "upstreamBody.on is not a function" on the first real request. A cast is
    // an assertion about runtime that the compiler cannot check — this does the
    // conversion the cast was pretending had happened.
    return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  }
}
