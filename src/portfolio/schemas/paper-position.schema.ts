import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PaperPositionDocument = PaperPosition & Document;

@Schema({ timestamps: true })
export class PaperPosition {
  @Prop({ type: Types.ObjectId, ref: 'PaperPortfolio', required: true })
  portfolioId: Types.ObjectId;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  symbol: string;

  @Prop({ required: true })
  exchange: string;

  @Prop({ required: true })
  quantity: number;

  @Prop({ required: true })
  averageCost: number;

  @Prop({ default: 0 })
  currentPrice: number;

  @Prop({ default: 0 })
  unrealisedPnl: number;

  /**
   * Declared stop for this position, carried over from the order that opened
   * or added to it. Nothing triggers on it — see the note on PaperOrder.
   * Undefined means no stop was declared, and that position's downside is
   * genuinely unbounded.
   */
  @Prop()
  stopLoss?: number;

  // Managed by `timestamps: true`, declared without @Prop so SchemaFactory
  // leaves them alone. `updatedAt` is when `currentPrice` was last refreshed,
  // which is what makes mark staleness detectable at all.
  createdAt?: Date;
  updatedAt?: Date;
}

export const PaperPositionSchema = SchemaFactory.createForClass(PaperPosition);
PaperPositionSchema.index({ portfolioId: 1, symbol: 1 }, { unique: true });
