import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { ChatTurn, ChatTurnDocument } from './schemas/chat-turn.schema';

/**
 * Consecutive turns about the same symbol belong to one conversation until the
 * user has been away long enough that they are plainly starting again. Two
 * hours is longer than a coffee break and shorter than a trading session.
 */
export const SESSION_GAP_MS = 2 * 60 * 60 * 1000;

/**
 * A turn's event stream is normally a dozen events. A pathological turn — a
 * model looping through tool calls — could produce far more, and every one of
 * them is stored and later read. Keeping the head and the tail preserves both
 * what the turn set out to do and how it ended.
 */
export const MAX_STORED_EVENTS = 200;

/** The shape the signals service returns for a chat turn. snake_case on the wire. */
export interface UpstreamTurn {
  turn_id?: string;
  symbol?: string;
  exchange?: string;
  /** The agent's answer. snake_case because that is what the wire carries. */
  message?: string;
  events?: Record<string, unknown>[];
  usage?: Record<string, unknown>;
  /** null on a normal answer; otherwise rounds/time/tokens/error/cancelled. */
  stop_reason?: string | null;
}

export interface SessionSummary {
  sessionId: string;
  symbol: string;
  exchange: string;
  turns: number;
  startedAt: Date;
  lastTurnAt: Date;
  /** The opening question — what the conversation is recognisably about. */
  title: string;
}

/** One backtest the agent ran, lifted out of the turn that ran it. */
export interface StrategyRun {
  turnId: string;
  sessionId: string;
  symbol: string;
  ranAt: Date;
  /** What the user asked that led to this run. */
  askedFor: string;
  label: string;
  detail: Record<string, unknown>;
}

@Injectable()
export class ChatSessionsService {
  private readonly logger = new Logger(ChatSessionsService.name);

  constructor(
    @InjectModel(ChatTurn.name)
    private readonly turnModel: Model<ChatTurnDocument>,
  ) {}

  // ------------------------------------------------------------------
  // Writing
  // ------------------------------------------------------------------

  /**
   * Store a completed turn.
   *
   * Idempotent on `turnId`: a turn reported twice — a stream that also
   * completes, a client retry — updates the one record rather than creating a
   * second. Returns null when the upstream response carried no turn id, which
   * means it came from a version that does not mint one; that is worth logging
   * but must never fail the user's request.
   */
  async recordTurn(
    userId: string,
    question: string,
    result: UpstreamTurn,
    options?: { forceNewSession?: boolean },
  ): Promise<ChatTurnDocument | null> {
    const turnId = result?.turn_id;
    if (!turnId) {
      this.logger.warn('Chat turn had no turn_id — not recorded');
      return null;
    }

    const symbol = (result.symbol ?? '').toUpperCase();
    const sessionId = await this.resolveSessionId(userId, symbol, options?.forceNewSession);

    return this.turnModel.findOneAndUpdate(
      { turnId },
      {
        $setOnInsert: {
          turnId,
          sessionId,
          userId,
          symbol,
          exchange: (result.exchange ?? 'NSE').toUpperCase(),
          message: question,
          answer: result.message ?? '',
          events: capEvents(result.events ?? []),
          usage: result.usage ?? {},
          stopReason: result.stop_reason ?? undefined,
        },
      },
      { upsert: true, new: true },
    );
  }

  /**
   * The conversation this turn continues, or a new one.
   *
   * Assigned server-side from the authenticated user: a client-supplied session
   * id would let one user append turns to another user's conversation.
   */
  private async resolveSessionId(
    userId: string,
    symbol: string,
    forceNew = false,
  ): Promise<string> {
    if (forceNew) return randomUUID();

    const previous = await this.turnModel
      .findOne({ userId, symbol })
      .sort({ createdAt: -1 })
      .lean();

    if (previous) {
      const age = Date.now() - new Date(previous.createdAt).getTime();
      if (age < SESSION_GAP_MS) return previous.sessionId;
    }
    return randomUUID();
  }

  // ------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------

  /** A user's conversations, most recently active first. */
  async listSessions(userId: string, limit = 30): Promise<SessionSummary[]> {
    const rows = await this.turnModel.aggregate<SessionSummary>([
      { $match: { userId } },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: '$sessionId',
          symbol: { $first: '$symbol' },
          exchange: { $first: '$exchange' },
          title: { $first: '$message' },
          startedAt: { $first: '$createdAt' },
          lastTurnAt: { $last: '$createdAt' },
          turns: { $sum: 1 },
        },
      },
      { $sort: { lastTurnAt: -1 } },
      { $limit: Math.min(Math.max(limit, 1), 100) },
      { $project: { _id: 0, sessionId: '$_id', symbol: 1, exchange: 1, title: 1, startedAt: 1, lastTurnAt: 1, turns: 1 } },
    ]);
    return rows;
  }

  /**
   * Every turn in one conversation, oldest first — the transcript.
   *
   * Scoped by userId as well as sessionId. Filtering on the id alone would let
   * anyone holding a session id read someone else's conversation.
   */
  async getSession(userId: string, sessionId: string): Promise<ChatTurnDocument[]> {
    return this.turnModel.find({ userId, sessionId }).sort({ createdAt: 1 });
  }

  /** The most recent conversation about a symbol — what the terminal reloads. */
  async getLatestForSymbol(userId: string, symbol: string): Promise<ChatTurnDocument[]> {
    const latest = await this.turnModel
      .findOne({ userId, symbol: symbol.toUpperCase() })
      .sort({ createdAt: -1 })
      .lean();
    if (!latest) return [];
    return this.getSession(userId, latest.sessionId);
  }

  /** One turn, by id. This is what "why was this trade taken" resolves. */
  async getTurn(userId: string, turnId: string): Promise<ChatTurnDocument> {
    const turn = await this.turnModel.findOne({ userId, turnId });
    // Not-found rather than forbidden for another user's turn: whether a given
    // turn id exists is not something a stranger should be able to determine.
    if (!turn) throw new NotFoundException('That turn is not available');
    return turn;
  }

  /**
   * Every backtest the agent has run for this user, newest first.
   *
   * Read out of the stored event stream rather than a separate table: the run,
   * its rules and its trades were already recorded there, and a second copy
   * would be a second thing to keep in sync.
   */
  async listStrategyRuns(userId: string, limit = 50): Promise<StrategyRun[]> {
    const turns = await this.turnModel
      .find({ userId, 'events.kind': 'strategy_run' })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 200))
      .lean();

    const runs: StrategyRun[] = [];
    for (const turn of turns) {
      for (const event of turn.events ?? []) {
        if (event?.kind !== 'strategy_run') continue;
        runs.push({
          turnId: turn.turnId,
          sessionId: turn.sessionId,
          symbol: turn.symbol,
          ranAt: turn.createdAt,
          askedFor: turn.message,
          label: String(event.label ?? 'Strategy run'),
          detail: (event.detail ?? {}) as Record<string, unknown>,
        });
      }
    }
    return runs;
  }
}

/** Head and tail of an oversized event stream, with an honest marker between. */
export function capEvents(
  events: Record<string, unknown>[],
  max = MAX_STORED_EVENTS,
): Record<string, unknown>[] {
  if (events.length <= max) return events;

  const half = Math.floor(max / 2);
  const dropped = events.length - max;
  return [
    ...events.slice(0, half),
    {
      kind: 'truncated',
      at_ms: null,
      label: `${dropped} steps omitted — this turn produced an unusual number`,
      detail: { dropped },
    },
    ...events.slice(events.length - (max - half)),
  ];
}
