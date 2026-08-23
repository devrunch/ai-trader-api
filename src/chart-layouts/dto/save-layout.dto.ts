import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * A chart carrying hundreds of overlays is unreadable anyway, and this bound is
 * what stops a loop in a client from growing one document without limit.
 */
export const MAX_DRAWINGS = 300;
export const MAX_INDICATORS = 20;
/** A Pine script is real source code, not a short name -- bounded so a
 *  runaway client can't grow one document without limit, same reasoning
 *  as MAX_DRAWINGS/MAX_INDICATORS above. */
export const MAX_INDICATOR_SOURCE_LENGTH = 20_000;

export class AttachedIndicatorDto {
  @IsString()
  id: string;

  @IsString()
  @MaxLength(MAX_INDICATOR_SOURCE_LENGTH)
  source: string;

  @IsString()
  label: string;

  @IsIn(['main', 'sub'])
  pane: 'main' | 'sub';

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  style?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  visibility?: { minInterval?: string; maxInterval?: string };
}

export class SaveLayoutDto {
  @IsString()
  exchange: string;

  /**
   * Overlays in the rendering adapter's own shape. Deliberately untyped
   * beyond "objects": the API does not interpret drawings, and a second
   * definition of the chart library's format would drift from the real one.
   */
  @IsArray()
  @ArrayMaxSize(MAX_DRAWINGS)
  drawings: Record<string, unknown>[];

  /** Attached Pine indicators -- source, not a catalog name (there is no
   *  catalog under the PineTS model). */
  @IsArray()
  @ArrayMaxSize(MAX_INDICATORS)
  @ValidateNested({ each: true })
  @Type(() => AttachedIndicatorDto)
  indicators: AttachedIndicatorDto[];

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
