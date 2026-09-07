import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AlertDocument = Alert & Document;

/**
 * A market-moving alert produced by one of the Python signals service's
 * two odd-cadence pipelines (hourly drift check, odd-hour Reddit-flavored
 * sentiment) -- shared by every user, so stored once per alert rather than
 * per user, same as MorningBrief.
 */
@Schema({ timestamps: true })
export class Alert {
  @Prop({ required: true, index: true })
  type: string; // 'drift' | 'reddit_sentiment'

  @Prop({ required: true })
  title: string;

  @Prop({ default: '' })
  body: string;

  @Prop({ type: [String], default: [], index: true })
  symbols: string[];

  @Prop({ type: Object, default: {} })
  data: Record<string, unknown>;
}

export const AlertSchema = SchemaFactory.createForClass(Alert);
// Newest-first is the only way this collection is ever read.
AlertSchema.index({ createdAt: -1 });
