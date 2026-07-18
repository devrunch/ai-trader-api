import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PaperTradeDocument = PaperTrade & Document;

@Schema({ timestamps: true })
export class PaperTrade {
  @Prop({ type: Types.ObjectId, ref: 'PaperPortfolio', required: true })
  portfolioId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PaperOrder', required: true })
  orderId: Types.ObjectId;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  symbol: string;

  @Prop({ required: true })
  exchange: string;

  @Prop({ required: true })
  side: string;

  @Prop({ required: true })
  quantity: number;

  @Prop({ required: true })
  price: number;

  @Prop({ default: 0 })
  realisedPnl: number;

  @Prop({ required: true })
  executedAt: Date;
}

export const PaperTradeSchema = SchemaFactory.createForClass(PaperTrade);
