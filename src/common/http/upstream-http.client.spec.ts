import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UpstreamHttpClient } from './upstream-http.client';

/*
 * The retry policy is the point of this suite.
 *
 * A network error means the request may or may not have reached upstream.
 * Retrying it blindly therefore risks running it twice — and on
 * `POST /signals/chat` that is a second full LLM turn: double the cost, and the
 * caller may receive the answer to a request it believes failed.
 */

const config = { get: () => 'http://signals:8001' } as never;

function client() {
  return new UpstreamHttpClient(config);
}

function ok(body: unknown = { ok: true }) {
  return { ok: true, status: 200, json: async () => body };
}

function status(code: number) {
  return { ok: false, status: code, json: async () => ({}) };
}

describe('UpstreamHttpClient retry policy', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
  });

  it('retries a GET once, because reading twice is harmless', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(ok({ price: 100 }));

    await expect(client().request('/quote')).resolves.toEqual({ price: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never retries a POST by default — it may already have been executed', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    await expect(
      client().request('/signals/chat', { method: 'POST', body: {} }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a POST that explicitly declares itself repeatable', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(ok({ results: [] }));

    await expect(
      client().request('/signals/evaluate', {
        method: 'POST',
        body: {},
        retryOnNetworkError: true,
      }),
    ).resolves.toEqual({ results: [] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 5xx — that is a real answer, not a lost request', async () => {
    fetchMock.mockResolvedValue(status(503));

    await expect(client().request('/quote')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('UpstreamHttpClient.stream', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
  });

  /** What `fetch` actually returns: a WEB ReadableStream, not a Node one. */
  function webStream(...chunks: string[]) {
    return new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
  }

  it('hands back a Node stream, not the web stream fetch produced', async () => {
    // This is the regression. An earlier version cast the web stream to
    // `NodeJS.ReadableStream` to satisfy the compiler: it type-checked, passed
    // every test that stubbed the client, and threw "upstreamBody.on is not a
    // function" on the first real request. Only asserting on the real fetch
    // shape catches it.
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: webStream('data: {}\n\n') });

    const body = await client().stream('/signals/chat/stream', { body: {} });

    expect(typeof body.on).toBe('function');
    expect(typeof body.pipe).toBe('function');
  });

  it('delivers the bytes upstream sent, in order', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: webStream('data: {"kind":"turn_started"}\n\n', 'data: {"kind":"result"}\n\n'),
    });

    const body = await client().stream('/signals/chat/stream', { body: {} });

    let seen = '';
    for await (const chunk of body) seen += String(chunk);

    expect(seen).toContain('turn_started');
    expect(seen.indexOf('turn_started')).toBeLessThan(seen.indexOf('result'));
  });

  it('reports an upstream refusal before any bytes are written', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, body: null });

    await expect(
      client().stream('/signals/chat/stream', { body: {} }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('never retries a stream — a replay would repeat events already delivered', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      client().stream('/signals/chat/stream', { body: {} }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('UpstreamHttpClient status mapping', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
  });

  it('maps a 404 to Not Found rather than a generic failure', async () => {
    fetchMock.mockResolvedValue(status(404));
    await expect(client().request('/missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports an upstream 500 as unavailable, not as the caller’s fault', async () => {
    fetchMock.mockResolvedValue(status(500));
    await expect(client().request('/broken')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('keeps a 4xx as a bad request', async () => {
    fetchMock.mockResolvedValue(status(422));
    await expect(client().request('/bad')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
