import {
  ArrayMaxSize,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * The alert payload posted by the Python signals service's drift-check and
 * reddit-sentiment pipelines. Same shape check discipline as StoreBriefDto:
 * bounded fields, no `any`, so a bug in either producer can't put unbounded
 * garbage into this collection.
 */
export class StoreAlertDto {
  @IsString()
  @IsIn(['drift', 'reddit_sentiment'])
  type: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  body?: string;

  @IsOptional()
  @ArrayMaxSize(20)
  symbols?: string[];

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
