import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * The brief payload posted by the Python signals service.
 *
 * snake_case, matching the producer. Previously this endpoint accepted `any`
 * and wrote six fields — including two unbounded arrays — straight into Mongo
 * with no shape check and no size limit, so a bug in the generator put garbage
 * into the collection that the frontend then rendered.
 */
export class StoreBriefDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  generated_at?: string;

  @IsOptional()
  @IsObject()
  market_read?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  global_cues?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  narrative?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  candidates?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  disclaimer?: string;
}
