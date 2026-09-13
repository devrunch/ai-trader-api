import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StoreSignalDto } from './dto/store-signal.dto';
import { SignalsInternalController } from './signals-internal.controller';
import { SignalsService } from './signals.service';

const VALID = {
  symbol: 'RELIANCE',
  exchange: 'NSE',
  direction: 'BUY',
  confidence: 0.8,
  entry_price: 2847,
  target_price: 2910,
  stop_loss: 2800,
  reasoning: 'trend',
  indicators: { rsi: 34.2 },
};

async function errorsFor(body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(StoreSignalDto, body), { whitelist: true });
  return errors.map((e) => e.property);
}

describe('StoreSignalDto', () => {
  it('accepts the payload the Python publisher sends', async () => {
    expect(await errorsFor(VALID)).toEqual([]);
  });

  it('rejects a payload missing prices or with an unknown direction', async () => {
    expect(await errorsFor({ ...VALID, entry_price: undefined })).toContain('entry_price');
    expect(await errorsFor({ ...VALID, direction: 'MAYBE' })).toContain('direction');
    expect(await errorsFor({ ...VALID, confidence: 7 })).toContain('confidence');
  });
});

describe('SignalsInternalController', () => {
  it('stores the signal and reports whether it was new', async () => {
    const persistSignal = jest.fn()
      .mockResolvedValueOnce({ _id: 'abc' })
      .mockResolvedValueOnce(null);
    const controller = new SignalsInternalController({ persistSignal } as unknown as SignalsService);

    await expect(controller.store(VALID as StoreSignalDto)).resolves.toEqual({ ok: true, saved: true });
    await expect(controller.store(VALID as StoreSignalDto)).resolves.toEqual({ ok: true, saved: false });
    expect(persistSignal).toHaveBeenCalledWith(VALID);
  });
});
