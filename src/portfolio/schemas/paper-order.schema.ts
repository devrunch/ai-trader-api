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

  @Prop({ required: true, enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @Prop()
  executedPrice?: number;

  @Prop()
  executedAt?: Date;

  @Prop()
  rejectionReason?: string;
}

export const PaperOrderSchema = SchemaFactory.createForClass(PaperOrder);
