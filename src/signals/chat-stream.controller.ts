import { Body, Controller, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatBudgetService } from '../chat/chat-budget.service';
import { ChatSessionsService, UpstreamTurn } from '../chat/chat-sessions.service';
import { SseFrames, dataOf, frame } from '../common/http/sse';
import { ChatDto } from './dto/chat.dto';
import { normaliseChatRequest } from './chat-request';
import { SignalsGateway } from './signals.gateway';
import { SignalsUpstreamClient } from './signals-upstream.client';

interface AuthRequest extends Request {
  user: { id: string; email: string; plan: string };
}

/**
 * The live chat turn.
 *
 * Its own controller because it is a different kind of route: it takes over the
 * response object, writes for up to a minute, and cannot use the interceptors
 * and serialisation every other endpoint relies on. Mixing that into
 * `SignalsController` would mean one file where half the handlers return values
 * and half write bytes.
 *
 * Note for deployment: this needs a runtime that streams. Behind API Gateway +
 * Lambda the response is buffered whatever these headers say, and the route
 * degrades to a slow `POST /chat` — correct, but not live.
 */
@UseGuards(JwtAuthGuard)
@Controller('signals')
export class ChatStreamController {
  private readonly logger = new Logger(ChatStreamController.name);

  constructor(
    private readonly upstream: SignalsUpstreamClient,
    private readonly chatSessions: ChatSessionsService,
    private readonly chatBudget: ChatBudgetService,
    private readonly gateway: SignalsGateway,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('chat/stream')
  async stream(
    @Req() req: AuthRequest,
    @Body() body: ChatDto,
    @Res() res: Response,
  ): Promise<void> {
    const { symbol, exchange, message, history } = normaliseChatRequest(body);

    // Checked before a single byte is written: once the response has started
    // it is a stream, and a limit reported inside a stream is a limit the
    // client has to learn how to read.
    await this.chatBudget.assertWithinBudget(req.user.id);

    // The turn must not outlive the reader it is running for. A browser that
    // navigates away closes the socket; that aborts the upstream fetch, which
    // cancels the turn in the signals service.
    //
    // Hooked to the RESPONSE, not the request: `req` emits 'close' once its
    // body has been consumed, which for a POST is immediately — that would
    // abort every healthy turn the moment it started. `res` closes when the
    // client is actually gone.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();   // we ended it = normal finish
    });

    let upstreamBody: Readable;
    try {
      upstreamBody = await this.upstream.chatStream(
        {
          symbol,
          exchange,
          message,
          history,
          // From the verified JWT, never the body — the agent's view of the
          // account is scoped to the authenticated user only.
          user_id: req.user.id,
          chart_state: this.gateway.getChartState(req.user.id),
        },
        abort.signal,
      );
    } catch (err) {
      // Nothing has been written yet, so this can still be an ordinary error
      // response with a status the client can act on.
      throw err;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Several proxies buffer by default, which turns a live stream back into
      // one delayed blob. `no-transform` above is the standards-track half of
      // the same instruction.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const frames = new SseFrames();
    let result: UpstreamTurn | null = null;
    // Kept so an abandoned turn still leaves a record. The spend happens
    // upstream whether or not anyone is reading, and a cost with no trace is
    // the one kind we could never explain later.
    const seen: Record<string, unknown>[] = [];
    let turnId: string | undefined;

    upstreamBody.on('data', (chunk: Buffer) => {
      // Forwarded verbatim. Re-encoding a frame we only half-understood is how
      // a proxy corrupts a stream that was fine.
      res.write(chunk);

      for (const raw of frames.push(chunk.toString('utf8'))) {
        const event = dataOf<{
          kind?: string;
          detail?: UpstreamTurn & { turn_id?: string };
        }>(raw);
        if (!event) continue;

        if (event.kind === 'result' && event.detail) {
          result = event.detail;
          continue;
        }
        if (event.kind === 'turn_started') turnId = event.detail?.turn_id;
        seen.push(event as Record<string, unknown>);
      }
    });

    upstreamBody.on('end', () => {
      void this.finish(req.user.id, message, result, res, body.newSession);
    });

    // The client hung up mid-turn. `end` may never fire, so this is the only
    // chance to record what was already paid for.
    res.on('close', () => {
      if (result || res.writableEnded) return;  // finished normally
      void this.recordCancelled(req.user.id, message, {
        turn_id: turnId, symbol, exchange, events: seen,
      }, body.newSession);
    });

    upstreamBody.on('error', (err: Error) => {
      // Headers are already sent, so an exception here would reach the client
      // as a truncated stream with no explanation. Send a final event instead.
      this.logger.error(`Chat stream for ${symbol} failed: ${err.message}`);
      if (!res.writableEnded) {
        res.write(
          frame({
            kind: 'error',
            label: 'The connection to the analysis service was lost',
            detail: {},
          }),
        );
        res.end();
      }
    });
  }

  /**
   * Record the turn, then close the stream.
   *
   * Recording is deliberately after the last event has been forwarded: the user
   * has their answer regardless, and a failed write is our problem, not theirs.
   */
  private async finish(
    userId: string,
    question: string,
    result: UpstreamTurn | null,
    res: Response,
    forceNewSession?: boolean,
  ): Promise<void> {
    if (result) {
      try {
        const stored = await this.chatSessions.recordTurn(userId, question, result, {
          forceNewSession,
        });
        if (stored && !res.writableEnded) {
          // The id the client needs to link a trade back to this analysis.
          res.write(frame({ kind: 'recorded', label: '', detail: { turnId: stored.turnId } }));
        }
      } catch (err) {
        this.logger.error(`Failed to record streamed turn: ${(err as Error)?.message}`);
      }
    }
    if (!res.writableEnded) res.end();
  }

  /**
   * Record a turn the user walked away from.
   *
   * Without this the cost is spent and nothing shows it: the daily budget is
   * summed from stored turns, so abandoned turns would be free to the limit and
   * invisible in support. Recorded with `stopReason: 'cancelled'` and an answer
   * that says so, rather than an empty string that would read as the agent
   * having nothing to say.
   */
  private async recordCancelled(
    userId: string,
    question: string,
    partial: UpstreamTurn,
    forceNewSession?: boolean,
  ): Promise<void> {
    if (!partial.turn_id) return;         // never started; nothing was spent
    try {
      await this.chatSessions.recordTurn(userId, question, {
        ...partial,
        message: 'Stopped before this analysis finished.',
        stop_reason: 'cancelled',
      }, { forceNewSession });
    } catch (err) {
      this.logger.error(`Failed to record a cancelled turn: ${(err as Error)?.message}`);
    }
  }
}
