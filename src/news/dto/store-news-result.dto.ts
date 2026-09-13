import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';

/**
 * The news-analysis payload posted by the Python signals service's
 * run_news_analysis task. Each article is opaque here (Record<string,
 * unknown>, same looseness StoreBriefDto gives globalCues/candidates) --
 * this endpoint's job is bounding the shape, not re-validating fields the
 * producer already validated against its own frontend contract.
 */
export class StoreNewsResultDto {
  @IsArray()
  @ArrayMaxSize(100)
  articles: Record<string, unknown>[];

  @IsInt()
  @Min(0)
  count: number;

  @IsBoolean()
  degraded: boolean;

  // @IsOptional() treats both `undefined` and JSON `null` as "not present"
  // and skips IsIn -- exactly what's wanted here, since the producer sends
  // an explicit `null` for "nothing degraded" rather than omitting the key.
  @IsOptional()
  @IsIn(['news_unavailable', 'impact_unavailable'])
  degraded_reason: string | null;
}
