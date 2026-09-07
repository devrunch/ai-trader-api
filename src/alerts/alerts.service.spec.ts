import { AlertsService } from './alerts.service';

/*
 * Two things worth a real test: store() fills in the optional fields'
 * defaults (Mongoose would too, but the fake model below is too minimal to
 * apply schema defaults itself) and broadcasts the saved doc, and recent()
 * hands back what was stored newest-first.
 */

type Doc = Record<string, any>;

function fakeModel() {
  const docs: Doc[] = [];
  return {
    get docs() {
      return docs;
    },
    create: jest.fn(async (data: Doc) => {
      const doc: Doc = { _id: `id-${docs.length + 1}`, createdAt: new Date(), ...data };
      doc.toObject = () => ({ ...doc });
      docs.unshift(doc); // newest-first, matching the real query's sort
      return doc;
    }),
    find: jest.fn(() => ({
      sort: jest.fn(() => ({
        limit: jest.fn((n: number) => ({
          lean: jest.fn(async () => docs.slice(0, n)),
        })),
      })),
    })),
  };
}

function fakeGateway() {
  return { broadcastAlert: jest.fn() };
}

function setup() {
  const model = fakeModel();
  const gateway = fakeGateway();
  return { model, gateway, service: new AlertsService(model as never, gateway as never) };
}

describe('AlertsService', () => {
  it('fills in defaults for the optional fields and broadcasts the saved doc', async () => {
    const f = setup();
    const saved = await f.service.store({ type: 'drift', title: 'Gold +1.2% in the last hour' } as never);

    expect(saved.body).toBe('');
    expect(saved.symbols).toEqual([]);
    expect(saved.data).toEqual({});
    expect(f.gateway.broadcastAlert).toHaveBeenCalledTimes(1);
    expect(f.gateway.broadcastAlert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Gold +1.2% in the last hour' }),
    );
  });

  it('keeps whatever body/symbols/data the caller actually sent', async () => {
    const f = setup();
    const saved = await f.service.store({
      type: 'reddit_sentiment',
      title: 'Reddit sentiment: india_equity',
      body: 'india_equity: bullish -- rate cut hopes',
      symbols: ['india_equity'],
      data: { topics: [{ topic: 'india_equity', sentiment: 'bullish', reason: 'x' }] },
    } as never);

    expect(saved.body).toBe('india_equity: bullish -- rate cut hopes');
    expect(saved.symbols).toEqual(['india_equity']);
    expect(saved.data).toEqual({ topics: [{ topic: 'india_equity', sentiment: 'bullish', reason: 'x' }] });
  });

  it('recent() returns the newest N, most recent first', async () => {
    const f = setup();
    await f.service.store({ type: 'drift', title: 'first' } as never);
    await f.service.store({ type: 'drift', title: 'second' } as never);
    await f.service.store({ type: 'drift', title: 'third' } as never);

    const result = await f.service.recent(2);

    expect(result.map((r: Doc) => r.title)).toEqual(['third', 'second']);
  });
});
