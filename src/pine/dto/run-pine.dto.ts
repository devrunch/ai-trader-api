import { ArrayMaxSize, IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/** Matches PineTS's own documented ceiling on candles per run -- anything
 * beyond that isn't meaningfully more useful and just costs more sandbox time. */
export const MAX_PINE_BARS = 5000;
export const MAX_PINE_SOURCE_LENGTH = 20_000;

export class RunPineDto {
  @IsString()
  @MaxLength(MAX_PINE_SOURCE_LENGTH)
  source: string;

  @IsArray()
  @ArrayMaxSize(MAX_PINE_BARS)
  bars: Record<string, unknown>[];

  @IsOptional()
  @IsIn(['indicator', 'strategy'])
  mode?: 'indicator' | 'strategy';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  symbol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  exchange?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  interval?: string;

  // Real PineTS input.*() overrides, keyed by the script's own variable
  // name (varId) -- e.g. { length: 50 } for `length = input.int(100, ...)`.
  // See ai-trader-signals/app/pine_sandbox/worker.mjs's Indicator usage.
  @IsOptional()
  @IsObject()
  inputOverrides?: Record<string, unknown>;
}
