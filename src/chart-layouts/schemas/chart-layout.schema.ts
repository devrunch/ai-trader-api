import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChartLayoutDocument = ChartLayout & Document;

/**
 * What the user has on their chart for one symbol: their own drawings, the
 * agent's, and which indicators are showing.
 *
 * All of it used to live in KLineChart's memory and nowhere else, so a reload
 * wiped a trend line the user had spent a minute placing — and every mark the
 * agent had put there to explain its answer.
 *
 * One document per user and symbol, replaced wholesale on save. A chart is
 * small and is always read and written as a unit, so there is nothing to gain
 * from storing overlays individually and a race to lose.
 */
@Schema({ timestamps: true })
export class ChartLayout {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  symbol: string;

  @Prop({ required: true })
  exchange: string;

  /**
   * Overlays, in the shape KLineChart creates them: `{ name, points, styles }`.
   * Stored as opaque objects — this service does not interpret drawings, and
   * validating a chart library's overlay format here would only mean two
   * definitions of it drifting apart.
   */
  @Prop({ type: [Object], default: [] })
  drawings: Record<string, unknown>[];

  /** Indicator names currently shown, e.g. ["EMA", "VOL"]. */
  @Prop({ type: [String], default: [] })
  indicators: string[];

  /**
   * Incremented on every save.
   *
   * Two tabs open on the same chart will otherwise silently overwrite each
   * other, and the loser never learns their drawings are gone. A save carrying
   * a stale version is rejected rather than applied.
   */
  @Prop({ required: true, default: 0 })
  version: number;

  /** Written by `timestamps: true`; declared for typing only, never a `@Prop`. */
  createdAt: Date;
  updatedAt: Date;
}

export const ChartLayoutSchema = SchemaFactory.createForClass(ChartLayout);

/** One layout per user per symbol — the natural key, enforced in the database. */
ChartLayoutSchema.index({ userId: 1, symbol: 1 }, { unique: true });
