import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ResetPortfolioDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  exchange?: string;
}
