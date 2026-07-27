import { Signal } from './schemas/signal.schema';

/**
 * The SQS payload published by the Python signals service
 * (`app/signals/service.py::_publish`).
 *
 * snake_case, matching the producer's language convention. This is the ONLY
 * description of that contract on the TypeScript side — every field crossing
 * the boundary is renamed in `toSignalDocument` below and nowhere else. Adding
 * a field to the publisher previously meant editing two byte-identical mappers
 * or the field was silently dropped (Mongoose `create` ignores unknown keys).
 */
export interface SignalMessage {
  symbol: string;
  exchange?: string;
  direction: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  confidence: number;
  reasoning?: string;
  indicators?: Record<string, unknown>;
  generated_at?: string;
}

/** snake_case SQS payload → camelCase Mongoose document. */
export function toSignalDocument(payload: SignalMessage): Partial<Signal> {
  return {
    symbol: payload.symbol,
    exchange: payload.exchange ?? 'NSE',
    direction: payload.direction,
    entryPrice: payload.entry_price,
    targetPrice: payload.target_price,
    stopLoss: payload.stop_loss,
    confidence: payload.confidence,
    reasoning: payload.reasoning,
    indicators: (payload.indicators ?? {}) as Record<string, unknown>,
    generatedAt: payload.generated_at
      ? new Date(payload.generated_at)
      : new Date(),
  };
}
