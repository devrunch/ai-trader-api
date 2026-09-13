import {
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SignalMessage } from '../signal.mapper';

/**
 * The signal payload the Python signals service POSTs to /api/internal/signals.
 * snake_case to match the producer; mapped to the document in signal.mapper.ts.
 */
export class StoreSignalDto implements SignalMessage {
  @IsString()
  @MaxLength(40)
  symbol: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  exchange?: string;

  @IsIn(['BUY', 'SELL'])
  direction: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  confidence: number;

  @IsNumber()
  @IsPositive()
  entry_price: number;

  @IsNumber()
  @IsPositive()
  target_price: number;

  @IsNumber()
  @IsPositive()
  stop_loss: number;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  reasoning?: string;

  @IsOptional()
  @IsObject()
  indicators?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  generated_at?: string;
}
