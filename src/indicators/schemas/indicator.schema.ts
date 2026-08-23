import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IndicatorDocument = Indicator & Document;

export type IndicatorPane = 'main' | 'sub' | 'volume';

/**
 * A Pine indicator, default or user-authored -- both live in the same
 * collection under the same shape, since the only real difference between
 * "one of the 49 built-ins" and "something a user pasted in" is who owns it.
 *
 * `ownerId: null` marks a default -- seeded once (see default-indicators.seed.ts)
 * and re-asserted idempotently on every boot, never created through the API.
 * A real user id marks a custom indicator, owned and writable only by that
 * user; reads return every default plus that user's own customs merged.
 */
@Schema({ timestamps: true })
export class Indicator {
  /** Stable slug, e.g. "sma" for a default or a generated id for a custom
   *  one -- NOT Mongo's own _id. Existing saved chart-layouts already
   *  reference the 49 default ids by this exact string (AttachedIndicator.id
   *  in chart-layout.schema.ts), so a default's id must never change once
   *  seeded, and must be assigned (not auto-generated) for that reason. */
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ type: String, default: null, index: true })
  ownerId: string | null;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  category: string;

  @Prop({ required: true, enum: ['main', 'sub', 'volume'] })
  pane: IndicatorPane;

  @Prop({ required: true })
  source: string;

  /** Written by `timestamps: true`; declared for typing only, never a `@Prop`. */
  createdAt: Date;
  updatedAt: Date;
}

export const IndicatorSchema = SchemaFactory.createForClass(Indicator);
