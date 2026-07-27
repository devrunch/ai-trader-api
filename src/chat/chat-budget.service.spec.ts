import { HttpException } from '@nestjs/common';
import { ChatBudgetService, DEFAULT_DAILY_TOKEN_CAP } from './chat-budget.service';

/*
 * The rate limiter bounds requests per minute. This bounds what a day of them
 * costs — a different question, and the one that shows up on a bill.
 */

type Doc = Record<string, any>;

function setup(opts: {
  tokens?: number;
  turns?: number;
  cap?: string;
  fails?: boolean;
  /** A per-user override an admin has set. Undefined = none set. */
  override?: number;
  userLookupFails?: boolean;
} = {}) {
  const model: Doc = {
    aggregate: jest.fn(async (pipeline: Doc[]) => {
      if (opts.fails) throw new Error('mongo is down');
      model.lastPipeline = pipeline;
      if (opts.tokens === undefined) return [];
      return [{ tokens: opts.tokens, turns: opts.turns ?? 1 }];
    }),
  };
  const userModel: Doc = {
    findById: jest.fn(() => ({
      select: () => ({
        lean: async () => {
          if (opts.userLookupFails) throw new Error('mongo is down');
          return opts.override === undefined ? {} : { dailyTokenCapOverride: opts.override };
        },
      }),
    })),
  };
  const config = { get: () => opts.cap } as never;
  return {
    model,
    userModel,
    service: new ChatBudgetService(model as never, userModel as never, config),
  };
}

describe('ChatBudgetService.spentToday', () => {
  it('reports nothing spent on a fresh day', async () => {
    const f = setup();
    const spend = await f.service.spentToday('u1');

    expect(spend).toEqual({
      tokens: 0,
      turns: 0,
      cap: DEFAULT_DAILY_TOKEN_CAP,
      remaining: DEFAULT_DAILY_TOKEN_CAP,
    });
  });

  it('counts only this user, and only since midnight', async () => {
    const f = setup({ tokens: 1000 });
    await f.service.spentToday('u1');

    const [{ $match }] = f.model.lastPipeline;
    expect($match.userId).toBe('u1');
    expect($match.createdAt.$gte).toBeInstanceOf(Date);
    expect($match.createdAt.$gte.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('reports what is left', async () => {
    const f = setup({ tokens: 50_000, turns: 4 });
    const spend = await f.service.spentToday('u1');

    expect(spend.turns).toBe(4);
    expect(spend.remaining).toBe(DEFAULT_DAILY_TOKEN_CAP - 50_000);
  });

  it('never reports a negative remainder', async () => {
    const f = setup({ tokens: DEFAULT_DAILY_TOKEN_CAP * 2 });
    expect((await f.service.spentToday('u1')).remaining).toBe(0);
  });

  it('honours a configured cap', async () => {
    const f = setup({ tokens: 0, cap: '1000' });
    expect((await f.service.spentToday('u1')).cap).toBe(1000);
  });

  it('falls back to the default for a nonsense cap', async () => {
    // A typo in the environment must not silently disable the limit.
    const f = setup({ tokens: 0, cap: 'lots' });
    expect((await f.service.spentToday('u1')).cap).toBe(DEFAULT_DAILY_TOKEN_CAP);
  });
});

describe('ChatBudgetService.assertWithinBudget', () => {
  it('allows a turn when there is budget left', async () => {
    const f = setup({ tokens: 1_000 });
    await expect(f.service.assertWithinBudget('u1')).resolves.toBeUndefined();
  });

  it('refuses a turn once the day is spent', async () => {
    const f = setup({ tokens: DEFAULT_DAILY_TOKEN_CAP, turns: 30 });
    await expect(f.service.assertWithinBudget('u1')).rejects.toBeInstanceOf(HttpException);
  });

  it('says what happened and when it clears, without jargon', async () => {
    const f = setup({ tokens: DEFAULT_DAILY_TOKEN_CAP });

    await expect(f.service.assertWithinBudget('u1')).rejects.toMatchObject({
      response: {
        statusCode: 429,
        message: expect.stringContaining('resets at midnight'),
      },
    });
  });

  it('reassures the user that nothing else is affected', async () => {
    // A limit that reads like an outage sends people to support.
    const f = setup({ tokens: DEFAULT_DAILY_TOKEN_CAP });
    try {
      await f.service.assertWithinBudget('u1');
      fail('should have thrown');
    } catch (err) {
      const body = (err as HttpException).getResponse() as { message: string };
      expect(body.message).toMatch(/charts, strategies and positions are unaffected/);
    }
  });

  it('allows the turn when the budget cannot be read', async () => {
    // A Mongo hiccup locking everyone out of the product's main feature is
    // worse than one uncounted turn.
    const f = setup({ fails: true });
    await expect(f.service.assertWithinBudget('u1')).resolves.toBeUndefined();
  });
});

describe('ChatBudgetService per-user cap override', () => {
  it('uses the platform default when no override is set', async () => {
    const f = setup({ tokens: 0 });
    expect((await f.service.spentToday('u1')).cap).toBe(DEFAULT_DAILY_TOKEN_CAP);
  });

  it('lets an admin raise one user above the default', async () => {
    const f = setup({ tokens: 0, override: 1_000_000 });
    expect((await f.service.spentToday('u1')).cap).toBe(1_000_000);
  });

  it('lets an admin cut a user off entirely with a cap of zero', async () => {
    // 0 is a real, meaningful value here — distinguished from "no override"
    // by typeof, not by truthiness.
    const f = setup({ tokens: 0, override: 0 });
    const spend = await f.service.spentToday('u1');

    expect(spend.cap).toBe(0);
    await expect(f.service.assertWithinBudget('u1')).rejects.toBeInstanceOf(HttpException);
  });

  it('falls back to the default when the override cannot be read', async () => {
    // Same fail-open policy as everywhere else in this service: a lookup
    // failure must not lock a user out of the product's main feature.
    const f = setup({ tokens: 0, userLookupFails: true });
    expect((await f.service.spentToday('u1')).cap).toBe(DEFAULT_DAILY_TOKEN_CAP);
  });

  it('looks up the override for the user asking, not some other user', async () => {
    const f = setup({ tokens: 0, override: 500 });
    await f.service.spentToday('u42');
    expect(f.userModel.findById).toHaveBeenCalledWith('u42');
  });
});
