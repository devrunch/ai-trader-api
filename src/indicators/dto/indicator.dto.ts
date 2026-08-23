import { IsIn, IsString, MaxLength } from 'class-validator';

/** Same bound as RunPineDto's source length (../pine/dto/run-pine.dto.ts) --
 *  a Pine script is real source code, not a short name, but still needs a
 *  ceiling so a runaway client can't grow one document without limit. */
export const MAX_SOURCE_LENGTH = 20_000;
export const MAX_NAME_LENGTH = 100;
export const MAX_CATEGORY_LENGTH = 50;

export class IndicatorDto {
  @IsString()
  @MaxLength(MAX_NAME_LENGTH)
  name: string;

  /** Free text, not a fixed enum -- the frontend offers the 5 built-in
   *  categories as suggestions, but a user's own indicator isn't restricted
   *  to them. */
  @IsString()
  @MaxLength(MAX_CATEGORY_LENGTH)
  category: string;

  @IsIn(['main', 'sub', 'volume'])
  pane: 'main' | 'sub' | 'volume';

  @IsString()
  @MaxLength(MAX_SOURCE_LENGTH)
  source: string;
}
