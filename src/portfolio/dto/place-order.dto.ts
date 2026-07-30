import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { OrderSide, OrderType } from '../schemas/paper-order.schema';

/**
 * Exchanges a paper order may actually be placed on.
 *
 * Deliberately narrower than the `Exchange` enum used elsewhere for portfolio
 * typing (which also lists NASDAQ, NYSE, FOREX for reading quotes and asking
 * the agent about them). The paper account is denominated in rupees —
 * `cashBalance` is a rupee figure — so an order in a dollar-priced symbol
 * would debit "200" rupees for a $200 fill with no conversion. Until that is
 * actually handled, trading stays NSE/BSE only; the exchange field was
 * previously `@IsString()` with no allowlist at all, so this was reachable
 * the moment anything upstream started offering non-Indian symbols.
 */
export enum TradableExchange {
  NSE = 'NSE',
  BSE = 'BSE',
}

export class PlaceOrderDto {
  @IsString()
  symbol: string;

  @IsEnum(TradableExchange, {
    message: 'Paper trading is available for NSE and BSE only right now',
  })
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

  /**
   * Optional declared stop for the position this order opens. Purely
   * informational — no STOP order type exists and nothing triggers on it — but
   * supplying it is what lets the aggregate-open-risk cap measure real risk
   * instead of falling back to a conservative assumption.
   */
  @IsNumber()
  @Min(0)
  @IsOptional()
  stopLoss?: number;

  /**
   * Idempotency key, generated once by the caller per order intent (a
   * `crypto.randomUUID()` is ideal). Re-sending the same key returns the
   * original order rather than placing a second one.
   *
   * Charset is restricted because this value is stored, indexed and echoed
   * back; length is bounded so it cannot be used to pad documents.
   */
  @IsString()
  @Length(8, 64)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'clientOrderId may contain only letters, digits, hyphen and underscore',
  })
  @IsOptional()
  clientOrderId?: string;

  /**
   * The agent turn this order came out of, when the user acted on something the
   * agent said.
   *
   * This is what makes "why did I take this trade" answerable: the turn record
   * holds the question, every tool the agent ran, the levels it quoted and the
   * answer it gave. Without the link, an order six weeks old is a row of
   * numbers with no story.
   *
   * Absent for a manually placed order, and the UI says so rather than showing
   * an empty reasoning panel.
   */
  @IsString()
  @Length(8, 64)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'decisionTurnId may contain only letters, digits, hyphen and underscore',
  })
  @IsOptional()
  decisionTurnId?: string;
}
