import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChatTurnDocument = ChatTurn & Document;

/**
 * One completed exchange with the agent: the question, the answer, and every
 * step taken in between.
 *
 * Nothing about a turn used to survive the request. Conversation history lived
 * in React state and vanished on reload, and a user who took a trade the agent
 * suggested had no way to see what it had actually looked at. This document is
 * that record.
 *
 * It is deliberately one document per turn rather than a growing conversation
 * document: turns are written once and never modified, so there is no
 * read-modify-write, no unbounded array, and a single turn can be fetched by id
 * without loading a whole session.
 *
 * **Retention:** no TTL. The events are large, but they are the evidence behind
 * a trade, and a trade's reasoning has to outlive any window we would pick —
 * "why did I take this" is asked most often long after the fact. Size is bounded
 * at write time instead (see MAX_STORED_EVENTS in chat-sessions.service.ts).
 */
@Schema({ timestamps: true })
export class ChatTurn {
  /**
   * Minted by the signals service at the start of the turn, so the streamed
   * path, the buffered path and this record all name the same turn. Unique:
   * recording is idempotent, because a turn may be reported twice (a stream
   * that also completes, a client retry).
   */
  @Prop({ required: true, unique: true, index: true })
  turnId: string;

  /**
   * Groups consecutive turns about the same symbol into a conversation.
   * Assigned here, not by the client — a client that picks its own would let
   * one user append to another's session.
   */
  @Prop({ required: true, index: true })
  sessionId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  symbol: string;

  @Prop({ required: true })
  exchange: string;

  /** What the user asked, verbatim. */
  @Prop({ required: true })
  message: string;

  /** What the agent answered. */
  @Prop({ required: true })
  answer: string;

  /**
   * The typed event stream for the turn: every tool call, its arguments, how
   * long it took and what it found, plus any strategy run in full.
   *
   * The same array that drove the live progress feed. Storing the stream rather
   * than a summary is what lets the strategies tab and the "why this trade"
   * panel read the real steps instead of a retelling.
   */
  @Prop({ type: [Object], default: [] })
  events: Record<string, unknown>[];

  /** Token counts and round usage, so a turn has a known cost. */
  @Prop({ type: Object, default: {} })
  usage: Record<string, unknown>;

  /** Why the turn ended: null for a normal answer, else rounds/time/tokens/error. */
  @Prop()
  stopReason?: string;

  /**
   * Written by `timestamps: true`. Declared for typing only — deliberately not
   * `@Prop`, or the decorator would add a second, unmanaged field alongside the
   * one Mongoose maintains.
   */
  createdAt: Date;
  updatedAt: Date;
}

export const ChatTurnSchema = SchemaFactory.createForClass(ChatTurn);

/** Listing a user's turns for one symbol, newest first — the terminal's load. */
ChatTurnSchema.index({ userId: 1, symbol: 1, createdAt: -1 });

/** Replaying one conversation in order. */
ChatTurnSchema.index({ sessionId: 1, createdAt: 1 });

/** Summing a user's spend for the day — read before every single chat turn. */
ChatTurnSchema.index({ userId: 1, createdAt: -1 });
