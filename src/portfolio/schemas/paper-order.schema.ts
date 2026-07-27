import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PaperOrderDocument = PaperOrder & Document;

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  EXECUTED = 'EXECUTED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

@Schema({ timestamps: true })
export class PaperOrder {
  @Prop({ type: Types.ObjectId, ref: 'PaperPortfolio', required: true })
  portfolioId: Types.ObjectId;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  symbol: string;

  @Prop({ required: true })
  exchange: string;

  @Prop({ required: true, enum: OrderSide })
  side: OrderSide;

  @Prop({ required: true, enum: OrderType, default: OrderType.MARKET })
  type: OrderType;

  @Prop({ required: true })
  quantity: number;

  @Prop()
  limitPrice?: number;

  /**
   * The price at which the caller intends to cut the loss on this position.
   *
   * This is NOT a stop-loss order — there is no STOP order type and no
   * monitoring loop, so nothing here will ever trigger an exit. It is recorded
   * so the aggregate-open-risk cap has a declared risk per position to sum,
   * and so the risk state can report honestly which positions have no stop at
   * all. Do not let anything present it as protection the account has.
   */
  @Prop()
  stopLoss?: number;

  @Prop({ required: true, enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @Prop()
  executedPrice?: number;

  @Prop()
  executedAt?: Date;

  @Prop()
  rejectionReason?: string;

  /**
   * Caller-supplied idempotency key.
   *
   * Placing an order is not idempotent by nature — a double-clicked button, a
   * client retry after a slow response, or a lost connection mid-request all
   * produce a second identical POST, and every one of them used to open a
   * second position. The caller generates this once per intent; a repeat with
   * the same key returns the original order instead of creating another.
   *
   * Optional, so existing callers keep working — but a caller that omits it
   * gets no protection.
   */
  @Prop()
  clientOrderId?: string;

  /**
   * The agent turn this order acted on, if any.
   *
   * Resolves through `GET /api/chat/turns/:turnId` to the full record of what
   * the agent was asked, what it looked up and what it concluded. Indexed
   * because the reverse question — "which trades came out of this analysis" —
   * is the one a user asks when reviewing a session.
   */
  @Prop({ index: true })
  decisionTurnId?: string;
}

export const PaperOrderSchema = SchemaFactory.createForClass(PaperOrder);

/**
 * Uniqueness is enforced in the database, not in application code: two
 * concurrent requests carrying the same key can both miss a `findOne` check.
 * Partial rather than sparse so it only applies to orders that actually supply
 * a key, and is scoped per user so one user's key can never collide with
 * another's.
 */
PaperOrderSchema.index(
  { userId: 1, clientOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientOrderId: { $type: 'string' } },
    name: 'uniq_user_client_order_id',
  },
);
