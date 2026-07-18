import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { Exchange } from '../schemas/paper-portfolio.schema';

export class CreatePortfolioDto {
  @IsEnum(Exchange)
  exchange: Exchange;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  initialCapital?: number;
}
