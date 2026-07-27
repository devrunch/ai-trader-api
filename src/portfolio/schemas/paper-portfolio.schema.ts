import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PaperPortfolioDocument = PaperPortfolio & Document;

export enum Exchange {
  NSE = 'NSE',
  BSE = 'BSE',
  NASDAQ = 'NASDAQ',
  NYSE = 'NYSE',
  FOREX = 'FOREX',
}

@Schema({ timestamps: true })
export class PaperPortfolio {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, enum: Exchange, default: Exchange.NSE })
  exchange: Exchange;

  @Prop({ required: true, default: 100000 })
  initialCapital: number;

  @Prop({ required: true, default: 100000 })
  cashBalance: number;

  @Prop({ default: 0 })
  totalPositionValue: number;

  @Prop({ default: 0 })
  realisedPnl: number;
}

export const PaperPortfolioSchema = SchemaFactory.createForClass(PaperPortfolio);
PaperPortfolioSchema.index({ userId: 1, exchange: 1 }, { unique: true });
