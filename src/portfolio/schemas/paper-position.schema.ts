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
}

export const PaperPositionSchema = SchemaFactory.createForClass(PaperPosition);
PaperPositionSchema.index({ portfolioId: 1, symbol: 1 }, { unique: true });
