import { BadRequestException } from '@nestjs/common';
import { normaliseChatRequest, SYMBOL_RE } from './chat-request';
import { ChatDto } from './dto/chat.dto';

function dto(overrides: Partial<ChatDto> = {}): ChatDto {
  return { symbol: 'RELIANCE', exchange: 'NSE', message: 'hi', history: [], ...overrides } as ChatDto;
}

describe('SYMBOL_RE', () => {
  it('accepts real NSE index tickers that contain a space', () => {
    expect(SYMBOL_RE.test('NIFTY BANK')).toBe(true);
    expect(SYMBOL_RE.test('NIFTY 50')).toBe(true);
  });

  it('still accepts ordinary equity tickers and index caret-prefixed symbols', () => {
    expect(SYMBOL_RE.test('RELIANCE')).toBe(true);
    expect(SYMBOL_RE.test('^NSEI')).toBe(true);
  });

  it('still rejects genuinely invalid input', () => {
    expect(SYMBOL_RE.test('')).toBe(false);
    expect(SYMBOL_RE.test('DROP TABLE;')).toBe(false);
    expect(SYMBOL_RE.test('a'.repeat(21))).toBe(false);
  });
});

describe('normaliseChatRequest', () => {
  it('accepts a chat request about NIFTY BANK', () => {
    const result = normaliseChatRequest(dto({ symbol: 'nifty bank' }));
    expect(result.symbol).toBe('NIFTY BANK');
  });

  it('still rejects an invalid symbol', () => {
    expect(() => normaliseChatRequest(dto({ symbol: 'DROP TABLE;' }))).toThrow(BadRequestException);
  });

  it('accepts a chat request about an MCX continuous contract', () => {
    const result = normaliseChatRequest(dto({ symbol: 'gold1!', exchange: 'mcx' }));
    expect(result.symbol).toBe('GOLD1!');
    expect(result.exchange).toBe('MCX');
  });
});
