import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { OrderSide, OrderType } from '../schemas/paper-order.schema';

export class PlaceOrderDto {
  @IsString()
  symbol: string;

  @IsString()
  exchange: string;

  @IsEnum(OrderSide)
  side: OrderSide;

  @IsEnum(OrderType)
  @IsOptional()
  type?: OrderType;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @IsOptional()
  limitPrice?: number;
}
