import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WatchlistItemDocument = WatchlistItem & Document;

@Schema({ timestamps: true })
export class WatchlistItem {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  symbol: string;

  @Prop({ required: true, default: 'NSE' })
  exchange: string;
}

export const WatchlistItemSchema = SchemaFactory.createForClass(WatchlistItem);
WatchlistItemSchema.index({ userId: 1, symbol: 1, exchange: 1 }, { unique: true });
