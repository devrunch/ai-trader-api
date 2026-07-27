import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SignalDocument = Signal & Document;

@Schema({ timestamps: true })
export class Signal {
  @Prop({ required: true, index: true })
  symbol: string;

  @Prop({ required: true })
  exchange: string;

  @Prop({ required: true })
  direction: string; // BUY | SELL

  @Prop({ required: true })
  entryPrice: number;

  @Prop({ required: true })
  targetPrice: number;

  @Prop({ required: true })
  stopLoss: number;

  @Prop({ required: true })
  confidence: number;

  @Prop()
  reasoning: string;

  @Prop({ type: Object })
  indicators: Record<string, unknown>;

  @Prop({ default: 'active' })
  status: string; // active | triggered | expired

  @Prop()
  generatedAt: Date;

  // Managed by `timestamps: true`, not by us — declared without @Prop so
  // SchemaFactory leaves them alone but they exist on the TypeScript type.
  // Code sorts and falls back on `createdAt`; without these declarations that
  // only compiled because it went through an `any`-shaped interface.
  createdAt?: Date;
  updatedAt?: Date;
}

export const SignalSchema = SchemaFactory.createForClass(Signal);
SignalSchema.index({ symbol: 1, createdAt: -1 });

// Idempotency key. SQS delivers at-least-once and, depending on the deployment,
// more than one consumer can see the same message — without this a redelivery
// silently created a second identical signal document.
SignalSchema.index(
  { symbol: 1, generatedAt: 1, direction: 1 },
  { unique: true },
);
