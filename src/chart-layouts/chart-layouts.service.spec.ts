import { ConflictException } from '@nestjs/common';
import { ChartLayoutsService } from './chart-layouts.service';

/*
 * The version check is the whole point of this suite.
 *
 * Two tabs open on the same chart will otherwise overwrite each other, and the
 * loser never learns their drawings are gone — the worst kind of data loss,
 * because it is silent. The fake therefore reproduces the one Mongo behaviour
 * that makes the check work: a `findOneAndUpdate` whose filter includes the
 * expected version matches nothing when the stored version has moved on.
 */

type Doc = Record<string, any>;

function fakeModel() {
  let doc: Doc | null = null;

  const lean = (value: unknown) => ({
    lean: () => Promise.resolve(value),
    then: (ok: (v: unknown) => unknown) => Promise.resolve(value).then(ok),
  });

  return {
    get current() {
      return doc;
    },
    seed(initial: Doc) {
      doc = { updatedAt: new Date(), ...initial };
    },
    findOne: jest.fn((filter: Doc) =>
      lean(doc && doc.userId === filter.userId && doc.symbol === filter.symbol ? doc : null),
    ),
    findOneAndUpdate: jest.fn((filter: Doc, update: Doc, opts: Doc) => {
      const matches =
        doc && doc.userId === filter.userId && doc.symbol === filter.symbol &&
        doc.version === filter.version;

      if (matches) {
        doc = { ...doc, ...update.$set, updatedAt: new Date() };
        return Promise.resolve(doc);
      }
      if (opts?.upsert && !doc) {
        doc = { ...update.$setOnInsert, ...update.$set, updatedAt: new Date() };
        return Promise.resolve(doc);
      }
      if (opts?.upsert && doc) {
        // The unique index refuses a second document for the same key.
        return Promise.reject(Object.assign(new Error('E11000'), { code: 11000 }));
      }
      return Promise.resolve(null);
    }),
    deleteOne: jest.fn(async () => {
      doc = null;
      return { deletedCount: 1 };
    }),
  };
}

function setup() {
  const model = fakeModel();
  return { model, service: new ChartLayoutsService(model as never) };
}

/** A minimal but real AttachedIndicator -- source is what the Pine model
 *  actually stores, not a catalog name. */
const pine = (label: string) => ({ id: label.toLowerCase(), source: `plot(close) // ${label}`, label, pane: 'main' as const });

const layout = (over: Doc = {}) => ({
  exchange: 'NSE',
  drawings: [{ name: 'segment', points: [{ timestamp: 1, value: 100 }] }],
  indicators: [pine('EMA'), pine('VOL')],
  ...over,
});

describe('ChartLayoutsService', () => {
  it('returns an empty chart rather than a 404 for a symbol never drawn on', async () => {
    // "You have not drawn here yet" is a normal state, not a missing resource.
    const f = setup();
    const view = await f.service.get('u1', 'reliance');

    expect(view).toMatchObject({ symbol: 'RELIANCE', drawings: [], indicators: [], version: 0 });
  });

  it('saves a first layout and hands back version 1', async () => {
    const f = setup();
    const saved = await f.service.save('u1', 'RELIANCE', layout());

    expect(saved.version).toBe(1);
    expect(saved.drawings).toHaveLength(1);
    expect(saved.indicators).toEqual([pine('EMA'), pine('VOL')]);
  });

  it('accepts the next save from the tab that is up to date', async () => {
    const f = setup();
    const first = await f.service.save('u1', 'RELIANCE', layout());
    const second = await f.service.save('u1', 'RELIANCE', layout({ version: first.version, indicators: [pine('MACD')] }));

    expect(second.version).toBe(2);
    expect(second.indicators).toEqual([pine('MACD')]);
  });

  it('refuses a save from a tab whose copy is stale', async () => {
    const f = setup();
    await f.service.save('u1', 'RELIANCE', layout());          // version 1
    await f.service.save('u1', 'RELIANCE', layout({ version: 1 })); // version 2

    // The second tab still believes it holds version 1.
    await expect(
      f.service.save('u1', 'RELIANCE', layout({ version: 1, indicators: [pine('BOLL')] })),
    ).rejects.toBeInstanceOf(ConflictException);

    // And the newer drawings survive.
    expect((await f.service.get('u1', 'RELIANCE')).version).toBe(2);
  });

  it('refuses a first save when the chart already exists elsewhere', async () => {
    const f = setup();
    await f.service.save('u1', 'RELIANCE', layout());

    // A tab that loaded before anything was saved sends no version at all.
    await expect(f.service.save('u1', 'RELIANCE', layout())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('tells the client which version it should have had', async () => {
    const f = setup();
    await f.service.save('u1', 'RELIANCE', layout());

    await expect(f.service.save('u1', 'RELIANCE', layout())).rejects.toMatchObject({
      response: { currentVersion: 1 },
    });
  });

  it('clearing a chart resets it to empty, ready to be saved again', async () => {
    const f = setup();
    await f.service.save('u1', 'RELIANCE', layout());

    const cleared = await f.service.clear('u1', 'RELIANCE');
    expect(cleared).toMatchObject({ drawings: [], version: 0 });

    // Version restarts, so the next save is a first save and must succeed.
    await expect(f.service.save('u1', 'RELIANCE', layout())).resolves.toMatchObject({
      version: 1,
    });
  });

  it('does not hand one user another user’s chart', async () => {
    const f = setup();
    await f.service.save('u1', 'RELIANCE', layout());

    expect((await f.service.get('u2', 'RELIANCE')).drawings).toEqual([]);
  });
});
