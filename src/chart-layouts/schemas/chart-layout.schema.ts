import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChartLayoutDocument = ChartLayout & Document;

/**
 * A single attached Pine indicator. There is no fixed catalog to look a name
 * up in under the PineTS model (see the migration spec's "Saved-layout
 * schema change") — the source IS the indicator, stored verbatim, exactly
 * like `drawings` below is already opaque by design.
 */
@Schema({ _id: false })
export class AttachedIndicator {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  source: string;

  @Prop({ required: true })
  label: string;

  @Prop({ required: true, enum: ['main', 'sub'] })
  pane: 'main' | 'sub';

  /** User overrides for this script's own input.*() declarations, keyed by
   *  varId -- TradingView-style per-instance settings. Untyped like
   *  `drawings` above: values are a script-defined mix of int/float/bool/
   *  string/color, and this service never interprets them, only stores. */
  @Prop({ type: Object, required: false })
  params?: Record<string, unknown>;

  /** Per-plot color/width/visibility, keyed by plot title -- TradingView's
   *  Style tab. Untyped for the same reason as `params`: this service never
   *  interprets it, only stores what the frontend sends. */
  @Prop({ type: Object, required: false })
  style?: Record<string, unknown>;

  /** TradingView's Visibility tab, scoped to this app's fixed interval set
   *  (see ai-trader-frontend's lib/periods.ts). */
  @Prop({ type: Object, required: false })
  visibility?: { minInterval?: string; maxInterval?: string };
}

export const AttachedIndicatorSchema = SchemaFactory.createForClass(AttachedIndicator);

/**
 * What the user has on their chart for one symbol: their own drawings, the
 * agent's, and which indicators are showing.
 *
 * All of it used to live in the chart library's memory and nowhere else, so
 * a reload wiped a trend line the user had spent a minute placing — and
 * every mark the agent had put there to explain its answer.
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
   * Overlays, in the rendering adapter's own shape (`format` names which
   * one — e.g. "lightweight-charts"). Stored as opaque objects — this
   * service does not interpret drawings, and validating a chart library's
   * overlay format here would only mean two definitions of it drifting
   * apart. The `format` tag exists so a *future* rendering-library swap can
   * tell which shape a stored record uses without another schema cutover.
   */
  @Prop({ type: [Object], default: [] })
  drawings: Record<string, unknown>[];

  /** Indicators currently attached — Pine source, not a catalog name. */
  @Prop({ type: [AttachedIndicatorSchema], default: [] })
  indicators: AttachedIndicator[];

  /**
   * Main pane's chart type (e.g. "candles", "line", "area") -- opaque like
   * `drawings`, for the same reason: the set of valid ids lives in the
   * frontend's own ChartTypeId union and grows over time, so this service
   * never validates against a list here. Absent on any layout saved before
   * chart-type selection existed; the frontend treats that the same as
   * "candles" (rendererFor's own unknown-id fallback).
   */
  @Prop({ required: false })
  chartType?: string;

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
