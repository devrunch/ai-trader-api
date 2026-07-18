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
  indicators: Record<string, any>;

  @Prop({ default: 'active' })
  status: string; // active | triggered | expired

  @Prop()
  generatedAt: Date;
}

export const SignalSchema = SchemaFactory.createForClass(Signal);
SignalSchema.index({ symbol: 1, createdAt: -1 });
