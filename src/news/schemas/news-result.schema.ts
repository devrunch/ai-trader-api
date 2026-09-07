import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type NewsResultDocument = NewsResult & Document;

/**
 * The latest news + sentiment + real per-headline stock-impact analysis,
 * generated every 15 min by the Python signals service's run_news_analysis
 * task -- shared by every user, so one singleton document (`key: 'latest'`)
 * rather than per-user, same as MorningBrief being one-per-date. Replaces
 * the old live proxy to the signals service (see market.controller.ts):
 * the real NewsAPI/HF/LLM work now happens on the pipeline's own schedule,
 * not in a user's request path.
 */
@Schema({ timestamps: true })
export class NewsResult {
  @Prop({ required: true, unique: true, index: true, default: 'latest' })
  key: string;

  @Prop({ type: [Object], default: [] })
  articles: Record<string, unknown>[];

  @Prop({ default: 0 })
  count: number;

  @Prop({ default: false })
  degraded: boolean;

  @Prop({ type: String, default: null })
  degradedReason: string | null;
}

export const NewsResultSchema = SchemaFactory.createForClass(NewsResult);
