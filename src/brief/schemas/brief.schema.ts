import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MorningBriefDocument = MorningBrief & Document;

/**
 * The pre-market brief, generated once daily by the Python signals service and
 * shared by every user — so it is stored as a single document per date rather
 * than per user.
 */
@Schema({ timestamps: true })
export class MorningBrief {
  @Prop({ required: true, unique: true, index: true })
  date: string; // YYYY-MM-DD (IST)

  @Prop({ required: true })
  generatedAt: string;

  @Prop({ type: Object, default: {} })
  marketRead: Record<string, unknown>;

  @Prop({ type: [Object], default: [] })
  globalCues: Record<string, unknown>[];

  @Prop({ default: '' })
  narrative: string;

  @Prop({ type: [Object], default: [] })
  candidates: Record<string, unknown>[];

  @Prop({ default: '' })
  disclaimer: string;
}

export const MorningBriefSchema = SchemaFactory.createForClass(MorningBrief);
