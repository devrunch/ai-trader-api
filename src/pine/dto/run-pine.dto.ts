import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
