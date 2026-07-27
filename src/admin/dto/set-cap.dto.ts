import { IsInt, IsOptional, Min } from 'class-validator';

export class SetCapDto {
  /**
   * The new daily token cap, or `null`/omitted to clear the override and
   * return the user to the platform default.
   *
   * `@IsOptional()` treats both `null` and `undefined` as "no value" and skips
   * the rest of the validators for them — which is exactly the "clear it"
   * case, so nothing else is needed to allow null through. `0` is a real
   * number, not empty, so it still runs `@IsInt`/`@Min(0)` and means "cut this
   * user off", not "no change".
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  cap: number | null;
}
