import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

/**
 * A chart carrying hundreds of overlays is unreadable anyway, and this bound is
 * what stops a loop in a client from growing one document without limit.
 */
export const MAX_DRAWINGS = 300;
export const MAX_INDICATORS = 20;

export class SaveLayoutDto {
  @IsString()
  exchange: string;

  /**
   * Overlays in KLineChart's own shape. Deliberately untyped beyond "objects":
   * the API does not interpret drawings, and a second definition of the chart
   * library's format would drift from the real one.
   */
  @IsArray()
  @ArrayMaxSize(MAX_DRAWINGS)
  drawings: Record<string, unknown>[];

  @IsArray()
  @ArrayMaxSize(MAX_INDICATORS)
  @IsString({ each: true })
  @Matches(/^[A-Z0-9]{1,12}$/, { each: true, message: 'Unrecognised indicator name' })
  indicators: string[];

  /**
   * The version this client last read. Omitted on a first save.
   *
   * Sending a stale version means another tab has saved since — the write is
   * rejected rather than applied, because the alternative is one tab silently
   * destroying the other's drawings.
   */
  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  version?: number;
}
