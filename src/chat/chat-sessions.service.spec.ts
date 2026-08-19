import { NotFoundException } from '@nestjs/common';
import {
  ChatSessionsService,
  MAX_STORED_EVENTS,
  SESSION_GAP_MS,
  capEvents,
} from './chat-sessions.service';

/*
 * The model is faked rather than backed by mongodb-memory-server so the suite
 * needs no binary download and no network. The fake reproduces the semantics
 * the service actually depends on: `findOneAndUpdate` with `$setOnInsert` and
 * `upsert` must NOT overwrite an existing document, which is what makes
 * recording a turn idempotent.
 */

type Doc = Record<string, any>;

function fakeModel() {
  const docs: Doc[] = [];

  const matches = (d: Doc, filter: Doc): boolean =>
    Object.entries(filter).every(([k, v]) => {
      if (k === 'events.kind') {
        return (d.events ?? []).some((e: Doc) => e.kind === v);
      }
      return d[k] === v;
    });

  const chain = (rows: Doc[]) => {
    const q: Doc = {
      sort: (spec: Doc) => {
        const [field, dir] = Object.entries(spec)[0] as [string, number];
        rows = [...rows].sort(
          (a, b) =>
            (new Date(a[field]).getTime() - new Date(b[field]).getTime()) * dir,
        );
        return q;
      },
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return q;
      },
      lean: () => Promise.resolve(rows),
      then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(ok, err),
    };
    return q;
  };

  const model: Doc = {
    docs,
    /**
     * Simulate time passing by back-dating what is already stored. The service
     * compares against the real `Date.now()`, so moving a fake clock FORWARD
     * would put existing documents in the future and make every gap negative.
     */
    advance: (ms: number) => {
      for (const d of docs) {
        d.createdAt = new Date(new Date(d.createdAt).getTime() - ms);
      }
    },
    find: jest.fn((filter: Doc = {}) => chain(docs.filter((d) => matches(d, filter)))),
    findOne: jest.fn((filter: Doc = {}) => {
      const rows = docs.filter((d) => matches(d, filter));
      const q = chain(rows);
      // findOne resolves to a single document, not an array.
      const single = (r: Doc[]) => r[0] ?? null;
      return {
        ...q,
        sort: (spec: Doc) => {
          const sorted = q.sort(spec);
          return {
            lean: () => Promise.resolve(single(docs.filter((d) => matches(d, filter)).sort((a, b) => {
              const [field, dir] = Object.entries(spec)[0] as [string, number];
              return (new Date(a[field]).getTime() - new Date(b[field]).getTime()) * dir;
            }))),
            then: (ok: (v: unknown) => unknown) =>
              Promise.resolve(single(sorted.lean ? rows : rows)).then(ok),
          };
        },
        lean: () => Promise.resolve(single(rows)),
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve(single(rows)).then(ok, err),
      };
    }),
    findOneAndUpdate: jest.fn(async (filter: Doc, update: Doc) => {
      const existing = docs.find((d) => matches(d, filter));
      if (existing) return existing; // $setOnInsert does nothing on an existing doc
      const doc = { ...update.$setOnInsert, createdAt: new Date() };
      docs.push(doc);
      return doc;
    }),
    aggregate: jest.fn(async () => {
      const bySession = new Map<string, Doc[]>();
      for (const d of [...docs].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )) {
        bySession.set(d.sessionId, [...(bySession.get(d.sessionId) ?? []), d]);
      }
      return [...bySession.entries()]
        .map(([sessionId, turns]) => ({
          sessionId,
          symbol: turns[0].symbol,
          exchange: turns[0].exchange,
          title: turns[0].message,
          startedAt: turns[0].createdAt,
          lastTurnAt: turns[turns.length - 1].createdAt,
          turns: turns.length,
        }))
        .sort(
          (a, b) =>
            new Date(b.lastTurnAt).getTime() - new Date(a.lastTurnAt).getTime(),
        );
    }),
  };
  return model;
}

function setup() {
  const model = fakeModel();
  return { model, service: new ChatSessionsService(model as never) };
}

const turn = (over: Doc = {}): Doc => ({
  turn_id: 't1',
  symbol: 'RELIANCE',
  exchange: 'NSE',
  message: 'Support sits at 1380.',
  events: [{ kind: 'turn_started', label: 'Analysing RELIANCE' }],
  usage: { total_tokens: 1200 },
  stop_reason: null,
  ...over,
});

describe('ChatSessionsService.recordTurn', () => {
  it('stores the question, the answer and the steps between them', async () => {
    const f = setup();
    const saved = await f.service.recordTurn('u1', 'where is support?', turn());

    expect(saved?.turnId).toBe('t1');
    expect(saved?.message).toBe('where is support?');
    expect(saved?.answer).toBe('Support sits at 1380.');
    expect(saved?.events).toHaveLength(1);
    expect(saved?.usage).toEqual({ total_tokens: 1200 });
  });

  it('is idempotent — the same turn reported twice is stored once', async () => {
    const f = setup();
    await f.service.recordTurn('u1', 'q', turn());
    await f.service.recordTurn('u1', 'q', turn({ message: 'a different answer' }));

    expect(f.model.docs).toHaveLength(1);
    // The first record wins: a replay must not rewrite history.
    expect(f.model.docs[0].answer).toBe('Support sits at 1380.');
  });

  it('records nothing, and does not throw, when there is no turn id', async () => {
    const f = setup();
    const saved = await f.service.recordTurn('u1', 'q', turn({ turn_id: undefined }));

    expect(saved).toBeNull();
    expect(f.model.docs).toHaveLength(0);
  });

  it('continues the same conversation for a follow-up question', async () => {
    const f = setup();
    await f.service.recordTurn('u1', 'first', turn({ turn_id: 't1' }));
    f.model.advance(60_000);
    await f.service.recordTurn('u1', 'and the resistance?', turn({ turn_id: 't2' }));

    expect(f.model.docs[0].sessionId).toBe(f.model.docs[1].sessionId);
  });

  it('starts a new conversation after a long gap', async () => {
    const f = setup();
    await f.service.recordTurn('u1', 'first', turn({ turn_id: 't1' }));
    f.model.advance(SESSION_GAP_MS + 1000);
    await f.service.recordTurn('u1', 'much later', turn({ turn_id: 't2' }));

    expect(f.model.docs[0].sessionId).not.toBe(f.model.docs[1].sessionId);
  });

  it('starts a new conversation immediately when forceNewSession is set, even seconds later', async () => {
    const f = setup();
    await f.service.recordTurn('u1', 'first', turn({ turn_id: 't1' }));
    f.model.advance(1); // real requests are never within the same millisecond
    await f.service.recordTurn('u1', 'new chat', turn({ turn_id: 't2' }), {
      forceNewSession: true,
    });

    expect(f.model.docs[0].sessionId).not.toBe(f.model.docs[1].sessionId);
  });

  it('a turn right after a forced new session still continues THAT session normally', async () => {
    const f = setup();
    await f.service.recordTurn('u1', 'first', turn({ turn_id: 't1' }));
    f.model.advance(1);
    await f.service.recordTurn('u1', 'new chat', turn({ turn_id: 't2' }), {
      forceNewSession: true,
    });
    f.model.advance(1);
    await f.service.recordTurn('u1', 'follow-up', turn({ turn_id: 't3' }));

    expect(f.model.docs[1].sessionId).toBe(f.model.docs[2].sessionId);
    expect(f.model.docs[0].sessionId).not.toBe(f.model.docs[1].sessionId);
  });

  it('keeps different symbols in different conversations', async () => {
    const f = setup();
    await f.service.recordTurn('u1', 'q', turn({ turn_id: 't1', symbol: 'RELIANCE' }));
    await f.service.recordTurn('u1', 'q', turn({ turn_id: 't2', symbol: 'TCS' }));

    expect(f.model.docs[0].sessionId).not.toBe(f.model.docs[1].sessionId);
  });
});

describe('ChatSessionsService recording a cancelled turn', () => {
  // The spend happens upstream whether or not anyone is reading, and a cost
  // with no trace is the one kind we could never explain later. It also has to
  // count against the daily budget, which is summed from stored turns.
  it('keeps the steps taken before the user walked away', async () => {
    const f = setup();
    const saved = await f.service.recordTurn('u1', 'what do you see?', turn({
      message: 'Stopped before this analysis finished.',
      stop_reason: 'cancelled',
      events: [{ kind: 'turn_started' }, { kind: 'tool_started', label: 'Reading the chart' }],
    }));

    expect(saved?.stopReason).toBe('cancelled');
    expect(saved?.events).toHaveLength(2);
    // Not an empty string, which would read as the agent having nothing to say.
    expect(saved?.answer).toContain('Stopped');
  });

  it('is idempotent against the turn completing after all', async () => {
    // `end` and the socket closing can race; whichever lands first wins, and
    // the other must not create a second document.
    const f = setup();
    await f.service.recordTurn('u1', 'q', turn({ stop_reason: 'cancelled' }));
    await f.service.recordTurn('u1', 'q', turn({ message: 'Support sits at 1380.' }));

    expect(f.model.docs).toHaveLength(1);
    expect(f.model.docs[0].stopReason).toBe('cancelled');
  });
});

describe('ChatSessionsService reading', () => {
  it('refuses to hand a turn to anyone but its owner', async () => {
    const f = setup();
    await f.service.recordTurn('u1', 'q', turn());

    await expect(f.service.getTurn('u2', 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // Not-found, not forbidden: whether a turn id exists is not something a
    // stranger should be able to determine.
    await expect(f.service.getTurn('u1', 't1')).resolves.toBeTruthy();
  });

  it('lists strategy runs out of the stored events, newest first', async () => {
    const f = setup();
    await f.service.recordTurn(
      'u1',
      'backtest an RSI cross',
      turn({
        turn_id: 't1',
        events: [
          { kind: 'turn_started', label: 'Analysing RELIANCE' },
          {
            kind: 'strategy_run',
            label: 'Backtested Custom strategy',
            detail: { num_trades: 8, win_rate: 50, trades: [{ pnl_pct: 1.2 }] },
          },
        ],
      }),
    );

    const runs = await f.service.listStrategyRuns('u1');
    expect(runs).toHaveLength(1);
    expect(runs[0].turnId).toBe('t1');
    // The question that caused the run travels with it — a row that only says
    // "8 trades" cannot tell the user why it was ever run.
    expect(runs[0].askedFor).toBe('backtest an RSI cross');
    expect(runs[0].detail.trades).toEqual([{ pnl_pct: 1.2 }]);
  });

  it('summarises a conversation by its opening question', async () => {
    const f = setup();
    await f.service.recordTurn('u1', 'where is support?', turn({ turn_id: 't1' }));
    f.model.advance(60_000);
    await f.service.recordTurn('u1', 'and resistance?', turn({ turn_id: 't2' }));

    const [session] = await f.service.listSessions('u1');
    expect(session.turns).toBe(2);
    expect(session.title).toBe('where is support?');
  });
});

describe('capEvents', () => {
  const events = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ kind: 'thinking', i }));

  it('leaves a normal turn untouched', () => {
    const out = capEvents(events(12));
    expect(out).toHaveLength(12);
  });

  it('keeps the start and the end of a runaway turn, and says what it dropped', () => {
    const out = capEvents(events(MAX_STORED_EVENTS + 50));

    expect(out).toHaveLength(MAX_STORED_EVENTS + 1); // + the marker
    expect(out[0]).toEqual({ kind: 'thinking', i: 0 });
    expect(out[out.length - 1]).toEqual({
      kind: 'thinking',
      i: MAX_STORED_EVENTS + 49,
    });

    const marker = out.find((e) => e.kind === 'truncated');
    expect(marker?.detail).toEqual({ dropped: 50 });
  });
});
