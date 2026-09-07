import { NewsService } from './news.service';

/*
 * store() upserts a single row regardless of how many times it's called
 * (the pipeline replaces its own last result, not a history), and
 * latest() returns a well-shaped empty result rather than throwing before
 * the very first pipeline tick has ever run.
 */

type Doc = Record<string, any>;

function fakeModel() {
  let doc: Doc | null = null;
  return {
    get current() {
      return doc;
    },
    findOneAndUpdate: jest.fn((_filter: Doc, update: Doc) => {
      doc = { ...update };
      return Promise.resolve(doc);
    }),
    findOne: jest.fn(() => ({
      lean: () => Promise.resolve(doc),
    })),
  };
}

function setup() {
  const model = fakeModel();
  return { model, service: new NewsService(model as never) };
}

describe('NewsService', () => {
  it('returns a well-shaped empty result before the first pipeline tick', async () => {
    const f = setup();
    const result = await f.service.latest();

    expect(result).toEqual({ articles: [], count: 0, degraded: true, degraded_reason: 'news_unavailable' });
  });

  it('store() then latest() round-trips the real payload', async () => {
    const f = setup();
    await f.service.store({
      articles: [{ id: 'a1', headline: 'CPI hotter than expected' }],
      count: 1,
      degraded: false,
      degraded_reason: null,
    } as never);

    const result = await f.service.latest();
    expect(result).toEqual({
      articles: [{ id: 'a1', headline: 'CPI hotter than expected' }],
      count: 1,
      degraded: false,
      degraded_reason: null,
    });
  });

  it('a second store() replaces the row instead of accumulating history', async () => {
    const f = setup();
    await f.service.store({ articles: [{ id: 'a1' }], count: 1, degraded: false, degraded_reason: null } as never);
    await f.service.store({ articles: [{ id: 'a2' }], count: 1, degraded: false, degraded_reason: null } as never);

    const result = await f.service.latest();
    expect(result.articles).toEqual([{ id: 'a2' }]);
  });
});
