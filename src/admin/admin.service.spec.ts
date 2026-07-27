import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

/*
 * The admin panel reads the same `chat_turns` collection `ChatBudgetService`
 * already sums per request — this suite checks it is the SAME number listed
 * across every user, not a second accounting that can quietly disagree with
 * the one that actually blocks a turn.
 */

type Doc = Record<string, any>;
type UserRow = { _id: string; email: string; role: string; plan: string; dailyTokenCapOverride?: number };

function setup(opts: {
  users?: UserRow[];
  usageRows?: { _id: string; tokens: number; turns: number; lastActiveAt?: Date }[];
  defaultCap?: number;
}) {
  const users = opts.users ?? [];
  const usageRows = opts.usageRows ?? [];
  const defaultCap = opts.defaultCap ?? 400_000;

  const userModel: Doc = {
    find: jest.fn(() => ({
      select: () => ({ lean: async () => users }),
    })),
    findByIdAndUpdate: jest.fn((id: string, update: Doc) => ({
      select: () => ({
        lean: async () => {
          const existing = users.find((u) => u._id === id);
          if (!existing) return null;
          if (update.$unset) delete existing.dailyTokenCapOverride;
          if (update.$set) Object.assign(existing, update.$set);
          return existing;
        },
      }),
    })),
  };

  const turnModel: Doc = {
    aggregate: jest.fn(async (pipeline: Doc[]) => {
      const match = pipeline[0].$match;
      if (match.userId) {
        // Single-user spend query, as used by setCap and recentTurns' cousin.
        const row = usageRows.find((r) => r._id === match.userId);
        return row ? [row] : [];
      }
      // The all-users usageToday() aggregation.
      return usageRows;
    }),
    find: jest.fn(() => ({
      sort: () => ({
        limit: () => ({
          select: () => ({ lean: async () => [] }),
        }),
      }),
    })),
  };

  const budget = { defaultCap } as Doc;
  return {
    userModel,
    turnModel,
    service: new AdminService(userModel as never, turnModel as never, budget as never),
  };
}

const user = (over: Partial<UserRow> = {}): UserRow => ({
  _id: 'u1', email: 'a@x.com', role: 'user', plan: 'free', ...over,
});

describe('AdminService.usageToday', () => {
  it('reports zero spend for a user with no turns today', async () => {
    const f = setup({ users: [user()] });
    const { users } = await f.service.usageToday();

    expect(users[0]).toMatchObject({
      tokensToday: 0, turnsToday: 0, cap: 400_000, capOverride: null, remaining: 400_000,
    });
  });

  it('merges usage onto the right user', async () => {
    const f = setup({
      users: [user({ _id: 'u1' }), user({ _id: 'u2', email: 'b@x.com' })],
      usageRows: [{ _id: 'u2', tokens: 5_000, turns: 3 }],
    });
    const { users } = await f.service.usageToday();

    expect(users.find((u) => u.userId === 'u1')!.tokensToday).toBe(0);
    expect(users.find((u) => u.userId === 'u2')!.tokensToday).toBe(5_000);
  });

  it('an override changes the cap and the remainder, not the spend', async () => {
    const f = setup({
      users: [user({ dailyTokenCapOverride: 1_000 })],
      usageRows: [{ _id: 'u1', tokens: 400, turns: 1 }],
    });
    const { users } = await f.service.usageToday();

    expect(users[0]).toMatchObject({ cap: 1_000, capOverride: 1_000, remaining: 600 });
  });

  it('sorts highest spenders first', async () => {
    const f = setup({
      users: [user({ _id: 'u1' }), user({ _id: 'u2' }), user({ _id: 'u3' })],
      usageRows: [
        { _id: 'u1', tokens: 100, turns: 1 },
        { _id: 'u2', tokens: 9_000, turns: 5 },
        { _id: 'u3', tokens: 500, turns: 2 },
      ],
    });
    const { users } = await f.service.usageToday();
    expect(users.map((u) => u.userId)).toEqual(['u2', 'u3', 'u1']);
  });

  it('totals only count users who were actually active today', async () => {
    const f = setup({
      users: [user({ _id: 'u1' }), user({ _id: 'u2' })],
      usageRows: [{ _id: 'u1', tokens: 100, turns: 1 }],
    });
    const { totals } = await f.service.usageToday();

    expect(totals).toMatchObject({
      tokensToday: 100, turnsToday: 1, activeUsersToday: 1, userCount: 2, defaultCap: 400_000,
    });
  });
});

describe('AdminService.setCap', () => {
  it('sets a new cap and returns the user with it applied', async () => {
    const f = setup({ users: [user()] });
    const out = await f.service.setCap('u1', 1_000);
    expect(out).toMatchObject({ cap: 1_000, capOverride: 1_000 });
  });

  it('accepts zero as a real cap, not as "no change"', async () => {
    const f = setup({ users: [user()] });
    const out = await f.service.setCap('u1', 0);
    expect(out).toMatchObject({ cap: 0, capOverride: 0, remaining: 0 });
  });

  it('clearing with null returns the user to the platform default', async () => {
    const f = setup({ users: [user({ dailyTokenCapOverride: 1_000 })] });
    const out = await f.service.setCap('u1', null);
    expect(out).toMatchObject({ cap: 400_000, capOverride: null });
  });

  it('raises for a user that does not exist', async () => {
    const f = setup({ users: [] });
    await expect(f.service.setCap('ghost', 1_000)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a malformed id is a 404, not a 500', async () => {
    // Mongoose throws a CastError for an id that isn't 24 hex chars, BEFORE
    // the query runs — a different failure shape than "well-formed but
    // absent", but the same thing to an admin who clicked a stale link.
    const f = setup({ users: [] });
    f.userModel.findByIdAndUpdate = jest.fn(() => ({
      select: () => ({
        lean: async () => { throw Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError' }); },
      }),
    }));
    await expect(f.service.setCap('not-an-id', 1_000)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a genuine database error is not swallowed as not-found', async () => {
    const f = setup({ users: [] });
    f.userModel.findByIdAndUpdate = jest.fn(() => ({
      select: () => ({
        lean: async () => { throw new Error('connection reset'); },
      }),
    }));
    await expect(f.service.setCap('u1', 1_000)).rejects.toThrow('connection reset');
  });
});
