import { BadRequestException } from '@nestjs/common';
import { ChatDto } from './dto/chat.dto';

// Space included: real NSE index tickers have one ("NIFTY 50", "NIFTY BANK").
export const SYMBOL_RE = /^[A-Z0-9^._ -]{1,20}$/;
// Which exchanges the agent can be ASKED about. Separate from which ones can be
// TRADED on — see PlaceOrderDto's own allowlist, which is deliberately
// narrower: a paper account is denominated in rupees, so an order in a
// dollar-priced symbol would silently mix currencies. Reading a NASDAQ chart
// and asking the AI about it carries none of that risk.
export const EXCHANGES = new Set(['NSE', 'BSE', 'NASDAQ', 'NYSE']);

export interface NormalisedChatRequest {
  symbol: string;
  exchange: string;
  message: string;
  history: unknown[];
}

/**
 * Validate and normalise a chat request.
 *
 * Shared by the buffered and the streamed route so they cannot drift: a symbol
 * the buffered endpoint rejects must not be reachable through the stream.
 */
export function normaliseChatRequest(body: ChatDto): NormalisedChatRequest {
  const symbol = (body.symbol ?? '').trim().toUpperCase();
  const exchange = (body.exchange ?? 'NSE').trim().toUpperCase();

  if (!SYMBOL_RE.test(symbol)) throw new BadRequestException(`Invalid symbol: ${body.symbol}`);
  if (!EXCHANGES.has(exchange)) throw new BadRequestException(`Invalid exchange: ${body.exchange}`);
  if (!body.message?.trim()) throw new BadRequestException('Message is required');

  return { symbol, exchange, message: body.message, history: body.history ?? [] };
}
