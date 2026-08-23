import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { IndicatorsService } from './indicators.service';

type Doc = Record<string, any>;

/** A minimal in-memory stand-in for the Mongoose model -- enough of find/
 *  updateOne/create/findOneAndUpdate/deleteOne/exists to exercise the real
 *  service logic, not a mock of Mongoose itself. */
function fakeModel() {
  const docs: Doc[] = [];

  return {
    get all() {
      return docs;
    },
    find: jest.fn((filter: Doc) => {
      const matches = docs.filter((d) => {
        if (filter.$or) {
          return filter.$or.some((clause: Doc) =>
            Object.entries(clause).every(([k, v]) => d[k] === v),
          );
        }
        return Object.entries(filter).every(([k, v]) => d[k] === v);
      });
      return {
        sort: () => ({ lean: () => Promise.resolve(matches) }),
      };
    }),
    updateOne: jest.fn((filter: Doc, update: Doc, opts: Doc) => {
      const existing = docs.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v));
      if (existing) {
        Object.assign(existing, update.$set);
      } else if (opts?.upsert) {
        docs.push({ ...update.$set });
      }
      return Promise.resolve({});
    }),
    create: jest.fn((doc: Doc) => {
      const created = { ...doc };
      docs.push(created);
      return Promise.resolve(created);
    }),
    findOneAndUpdate: jest.fn((filter: Doc, update: Doc, opts: Doc) => {
      const existing = docs.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v));
      if (!existing) return Promise.resolve(null);
      Object.assign(existing, update.$set);
      return Promise.resolve(opts?.new ? existing : null);
    }),
    deleteOne: jest.fn((filter: Doc) => {
      const idx = docs.findIndex((d) => Object.entries(filter).every(([k, v]) => d[k] === v));
      if (idx === -1) return Promise.resolve({ deletedCount: 0 });
      docs.splice(idx, 1);
      return Promise.resolve({ deletedCount: 1 });
    }),
    exists: jest.fn((filter: Doc) => {
      const found = docs.some((d) => Object.entries(filter).every(([k, v]) => d[k] === v));
      return Promise.resolve(found ? { _id: 'x' } : null);
    }),
  };
}

function setup() {
  const model = fakeModel();
  return { model, service: new IndicatorsService(model as never) };
}

const custom = (over: Doc = {}) => ({
  name: 'My Custom SMA', category: 'Moving Averages', pane: 'main' as const,
  source: '//@version=5\nindicator("t")\nplot(ta.sma(close, 20))',
  ...over,
});

describe('IndicatorsService', () => {
  it('seeds all defaults on module init, owned by nobody', async () => {
    const f = setup();
    await f.service.onModuleInit();

    expect(f.model.all.length).toBeGreaterThan(40); // all 49 defaults
    expect(f.model.all.every((d) => d.ownerId === null)).toBe(true);
    expect(f.model.all.some((d) => d.id === 'sma')).toBe(true);
  });

  it('seeding twice does not duplicate defaults -- upsert by id', async () => {
    const f = setup();
    await f.service.onModuleInit();
    const countAfterFirst = f.model.all.length;
    await f.service.onModuleInit();

    expect(f.model.all.length).toBe(countAfterFirst);
  });

  it('listAll returns every default plus only this user\'s own customs', async () => {
    const f = setup();
    await f.service.onModuleInit();
    await f.service.create('u1', custom());
    await f.service.create('u2', custom({ name: 'u2 only' }));

    const view = await f.service.listAll('u1');

    expect(view.filter((i) => i.ownerId === null).length).toBeGreaterThan(40);
    expect(view.some((i) => i.name === 'My Custom SMA' && i.ownerId === 'u1')).toBe(true);
    expect(view.some((i) => i.name === 'u2 only')).toBe(false); // not u1's
  });

  it('create generates a stable id derived from the name, owned by the creator', async () => {
    const f = setup();
    const created = await f.service.create('u1', custom());

    expect(created.id).toMatch(/^custom-my-custom-sma-/);
    expect(created.ownerId).toBe('u1');
  });

  it('two customs with the same name never collide on id', async () => {
    const f = setup();
    const a = await f.service.create('u1', custom());
    const b = await f.service.create('u1', custom());

    expect(a.id).not.toBe(b.id);
  });

  it('a user can update their own custom indicator', async () => {
    const f = setup();
    const created = await f.service.create('u1', custom());
    const updated = await f.service.update('u1', created.id, custom({ name: 'Renamed' }));

    expect(updated.name).toBe('Renamed');
  });

  it('updating another user\'s indicator is forbidden, not silently ignored', async () => {
    const f = setup();
    const created = await f.service.create('u1', custom());

    await expect(f.service.update('u2', created.id, custom())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('editing a default indicator is forbidden -- ownerId null never matches a real user', async () => {
    const f = setup();
    await f.service.onModuleInit();

    await expect(f.service.update('u1', 'sma', custom())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updating an id that exists nowhere at all is a 404, not a 403', async () => {
    const f = setup();

    await expect(f.service.update('u1', 'does-not-exist', custom())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a user can delete their own custom indicator', async () => {
    const f = setup();
    const created = await f.service.create('u1', custom());

    await f.service.remove('u1', created.id);

    expect(f.model.all.some((d) => d.id === created.id)).toBe(false);
  });

  it('deleting a default indicator is forbidden', async () => {
    const f = setup();
    await f.service.onModuleInit();

    await expect(f.service.remove('u1', 'sma')).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.model.all.some((d) => d.id === 'sma')).toBe(true); // untouched
  });
});
