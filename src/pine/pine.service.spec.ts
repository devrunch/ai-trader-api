import { PineService } from './pine.service';
import { UpstreamHttpClient } from '../common/http/upstream-http.client';

describe('PineService', () => {
  it('proxies to /signals/pine/run with the dto body and defaults mode to indicator', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true, plots: { SMA5: [1, 2, 3] }, strategy: null, error: null });
    const http = { request } as unknown as UpstreamHttpClient;
    const service = new PineService(http);

    const result = await service.run({ source: 'plot(close)', bars: [{ open: 1 }] });

    expect(request).toHaveBeenCalledWith('/signals/pine/run', expect.objectContaining({
      method: 'POST',
      body: { source: 'plot(close)', bars: [{ open: 1 }], mode: 'indicator' },
    }));
    expect(result.ok).toBe(true);
  });

  it('passes through an explicit strategy mode', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true, plots: null, strategy: { opentrades: [] }, error: null });
    const http = { request } as unknown as UpstreamHttpClient;
    const service = new PineService(http);

    await service.run({ source: 'strategy.entry(...)', bars: [], mode: 'strategy' });

    expect(request).toHaveBeenCalledWith('/signals/pine/run', expect.objectContaining({
      body: expect.objectContaining({ mode: 'strategy' }),
    }));
  });
});
