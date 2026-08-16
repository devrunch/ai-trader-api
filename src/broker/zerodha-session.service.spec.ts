import { ZerodhaSessionService } from './zerodha-session.service';

type Doc = Record<string, any>;

function fakeModel() {
  let doc: Doc | null = null;
  const lean = (value: unknown) => ({
    lean: () => Promise.resolve(value),
  });
  return {
    get current() {
      return doc;
    },
    findOne: jest.fn(() => lean(doc)),
    findOneAndUpdate: jest.fn((_filter: Doc, update: Doc, opts: Doc) => {
      doc = { ...(doc ?? {}), ...update.$set, ...(opts?.upsert ? update.$setOnInsert : {}) };
      return { lean: () => Promise.resolve(doc) };
    }),
  };
}

function setup() {
  const model = fakeModel();
  return { model, service: new ZerodhaSessionService(model as never) };
}

describe('ZerodhaSessionService', () => {
  it('returns nulls when no session has ever been stored', async () => {
    const f = setup();
    const view = await f.service.get();

    expect(view).toEqual({ accessToken: null, refreshedAt: null });
  });

  it('stores a fresh token and hands it back', async () => {
    const f = setup();
    const saved = await f.service.set('tok_123');

    expect(saved.accessToken).toBe('tok_123');
    expect(saved.refreshedAt).toBeInstanceOf(Date);

    const view = await f.service.get();
    expect(view.accessToken).toBe('tok_123');
  });

  it('a second refresh replaces the first, not adds to it', async () => {
    const f = setup();
    await f.service.set('tok_123');
    await f.service.set('tok_456');

    const view = await f.service.get();
    expect(view.accessToken).toBe('tok_456');
  });
});
