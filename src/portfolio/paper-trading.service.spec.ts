import { BadRequestException } from '@nestjs/common';
import { OrderExecutionService } from './order-execution.service';
import { PaperTradingService } from './paper-trading.service';
import { PortfolioAccountsService } from './portfolio-accounts.service';
import { RiskLimitsService } from './risk-limits.service';
import { Exchange } from './schemas/paper-portfolio.schema';
import { OrderSide, OrderStatus, OrderType } from './schemas/paper-order.schema';

/*
 * The models are faked rather than backed by mongodb-memory-server so the suite
 * needs no binary download and no network. The fakes reproduce exactly the
 * Mongoose surface the service touches — notably the CONDITIONAL semantics of
 * `findOneAndUpdate({ cashBalance: { $gte: n } }, { $inc: ... })`, which is what
 * makes the cash movement race-free.
 */

type Doc = Record<string, any>;

function makeDoc(data: Doc): Doc {
  const d: Doc = { ...data };
  d.save = jest.fn(async () => d);
  d.deleteOne = jest.fn(async () => {
    d.__deleted = true;
    return { deletedCount: 1 };
  });
  d.toObject = () => ({ ...d });
  return d;
}

/** A thenable that also answers `.lean()` / `.sort()` / `.limit()`. */
function query(value: unknown): Doc {
  const q: Doc = {
    lean: () => Promise.resolve(value),
    sort: () => q,
    limit: () => q,
    then: (onOk: (v: unknown) => unknown, onErr: (e: unknown) => unknown) =>
      Promise.resolve(value).then(onOk, onErr),
  };
  return q;
}

interface PositionOpt {
  symbol: string;
  quantity: number;
  averageCost: number;
  /** Declared stop. Absent means the risk cap must fall back to its assumption. */
  stopLoss?: number;
}

interface SetupOptions {
  cash?: number;
  position?: PositionOpt;
  /** Several open positions at once — for the concurrent-position cap. */
  positions?: PositionOpt[];
  /** Already-booked trades, for the session realised-P&L the daily loss limit reads. */
  trades?: { realisedPnl: number; executedAt?: Date }[];
  ltp?: number;
  /** Make the upstream price fetch fail, to exercise the stale-price path. */
  ltpFails?: boolean;
}

function setup(opts: SetupOptions = {}) {
  let seq = 0;
  const portfolio = makeDoc({
    _id: 'pf1',
    userId: 'u1',
    exchange: Exchange.NSE,
    initialCapital: 100000,
    cashBalance: opts.cash ?? 100000,
    totalPositionValue: 0,
    realisedPnl: 0,
  });

  const positions: Doc[] = [];
  const seeded = [...(opts.positions ?? []), ...(opts.position ? [opts.position] : [])];
  seeded.forEach((p, i) => {
    positions.push(
      makeDoc({
        _id: `pos${i}`,
        portfolioId: 'pf1',
        userId: 'u1',
        exchange: 'NSE',
        currentPrice: p.averageCost,
        unrealisedPnl: 0,
        ...p,
      }),
    );
  });
  const orders: Doc[] = [];
  const trades: Doc[] = (opts.trades ?? []).map((t, i) =>
    makeDoc({
      _id: `seedt${i}`,
      userId: 'u1',
      exchange: Exchange.NSE,
      symbol: 'TCS',
      realisedPnl: t.realisedPnl,
      executedAt: t.executedAt ?? new Date(),
    }),
  );

  const applyInc = (target: Doc, update: Doc) => {
    for (const [k, v] of Object.entries(update?.$inc ?? {})) {
      target[k] = (target[k] ?? 0) + (v as number);
    }
  };

  const portfolioModel: Doc = {
    findOne: jest.fn(() => query(portfolio)),
    findById: jest.fn(() => query(portfolio)),
    create: jest.fn(async () => portfolio),
    findOneAndUpdate: jest.fn(async (filter: Doc, update: Doc) => {
      const min = filter?.cashBalance?.$gte;
      if (min !== undefined && portfolio.cashBalance < min) return null;
      applyInc(portfolio, update);
      return portfolio;
    }),
    updateOne: jest.fn(async (_filter: Doc, update: Doc) => {
      applyInc(portfolio, update);
      return { modifiedCount: 1 };
    }),
    deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
    find: jest.fn(() => query([portfolio])),
  };

  const live = () => positions.filter((p) => !p.__deleted);

  const positionModel: Doc = {
    findOne: jest.fn((f: Doc) =>
      query(live().find((p) => p.symbol === f.symbol) ?? null),
    ),
    find: jest.fn(() => query(live())),
    create: jest.fn(async (d: Doc) => {
      const p = makeDoc({ _id: `pos${++seq}`, ...d });
      positions.push(p);
      return p;
    }),
    deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
  };

  const orderModel: Doc = {
    create: jest.fn(async (d: Doc) => {
      // Reproduces the unique partial index on (userId, clientOrderId). Without
      // it the idempotency tests would pass here and fail in production, which
      // is the failure mode fakes exist to avoid.
      if (
        d.clientOrderId &&
        orders.some(
          (o) => o.userId === d.userId && o.clientOrderId === d.clientOrderId,
        )
      ) {
        throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
      }
      const o = makeDoc({ _id: `o${++seq}`, ...d });
      orders.push(o);
      return o;
    }),
    findById: jest.fn((id: unknown) =>
      query(orders.find((o) => o._id === String(id)) ?? null),
    ),
    findOne: jest.fn((f: Doc = {}) =>
      query(
        orders.find((o) =>
          Object.entries(f).every(([k, v]) => o[k] === v),
        ) ?? null,
      ),
    ),
    find: jest.fn(() => query(orders)),
    deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
  };

  const tradeModel: Doc = {
    create: jest.fn(async (d: Doc) => {
      const t = makeDoc({ _id: `t${++seq}`, ...d });
      trades.push(t);
      return t;
    }),
    findOne: jest.fn((f: Doc = {}) =>
      query(
        trades.find((t) => String(t.orderId) === String(f.orderId)) ?? null,
      ),
    ),
    // The session-realised-P&L read filters on `executedAt: { $gte }`, so the
    // fake honours that filter — otherwise the daily loss limit would appear to
    // work in tests while summing every trade ever made in production.
    find: jest.fn((f: Doc = {}) => {
      const from = f?.executedAt?.$gte as Date | undefined;
      return query(
        from ? trades.filter((t) => new Date(t.executedAt as string) >= from) : trades,
      );
    }),
    deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
  };

  const price = { value: opts.ltp ?? 100 };
  const market: Doc = {
    ltp: jest.fn(async () => {
      if (opts.ltpFails) throw new Error('upstream down');
      return price.value;
    }),
  };
  const gateway: Doc = {
    emitOrderUpdate: jest.fn(),
    emitPositionUpdate: jest.fn(),
  };

  // The service was split into three collaborators; they are wired here by
  // hand rather than through Nest so the suite still needs no test module.
  // Every assertion below is unchanged by that split — which is the point of
  // running them against the real objects rather than mocking the seams.
  const accounts = new PortfolioAccountsService(
    portfolioModel as never,
    positionModel as never,
    orderModel as never,
    tradeModel as never,
    market as never,
    gateway as never,
  );
  const risk = new RiskLimitsService(tradeModel as never, accounts);
  const execution = new OrderExecutionService(
    portfolioModel as never,
    positionModel as never,
    orderModel as never,
    tradeModel as never,
    accounts,
    gateway as never,
  );
  const service = new PaperTradingService(
    orderModel as never,
    tradeModel as never,
    accounts,
    risk,
    execution,
  );

  return {
    service, portfolio, positions, orders, trades, price, gateway, live,
    orderModel, tradeModel, portfolioModel,
  };
}

describe('PaperTradingService.placeOrder idempotency', () => {
  const buy = (clientOrderId?: string) => ({
    symbol: 'TCS',
    exchange: 'NSE',
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    quantity: 10,
    ...(clientOrderId ? { clientOrderId } : {}),
  });

  it('places one order when the same request arrives twice', async () => {
    const f = setup({ cash: 100000, ltp: 100 });

    const first = (await f.service.placeOrder('u1', buy('order-abc-123'))) as Doc;
    const second = (await f.service.placeOrder('u1', buy('order-abc-123'))) as Doc;

    expect(f.orders).toHaveLength(1);
    expect(second.order._id).toBe(first.order._id);
    // Cash moved once. This is the whole point: a double-clicked buy button
    // used to open two positions and debit twice.
    expect(f.portfolio.cashBalance).toBe(99000);
    expect(f.live()).toHaveLength(1);
    expect(f.live()[0].quantity).toBe(10);
  });

  it('returns the original fill price, not an order that looks unexecuted', async () => {
    const f = setup({ cash: 100000, ltp: 100 });

    await f.service.placeOrder('u1', buy('order-abc-123'));
    f.price.value = 250; // the market moved between the two attempts
    const retry = (await f.service.placeOrder('u1', buy('order-abc-123'))) as Doc;

    expect(retry.status).toBe(OrderStatus.EXECUTED);
    expect(retry.executedPrice).toBe(100);
    expect(retry.trade).not.toBeNull();
  });

  it('survives losing the race, when both requests pass the pre-check', async () => {
    const f = setup({ cash: 100000, ltp: 100 });

    const [a, b] = (await Promise.all([
      f.service.placeOrder('u1', buy('order-race-1')),
      f.service.placeOrder('u1', buy('order-race-1')),
    ])) as Doc[];

    expect(f.orders).toHaveLength(1);
    expect(a.order._id).toBe(b.order._id);
    expect(f.portfolio.cashBalance).toBe(99000);
  });

  it('treats different keys as different orders', async () => {
    const f = setup({ cash: 100000, ltp: 100 });

    await f.service.placeOrder('u1', buy('order-1'));
    await f.service.placeOrder('u1', buy('order-2'));

    expect(f.orders).toHaveLength(2);
    expect(f.portfolio.cashBalance).toBe(98000);
  });

  it('places every order when no key is supplied — no key, no protection', async () => {
    const f = setup({ cash: 100000, ltp: 100 });

    await f.service.placeOrder('u1', buy());
    await f.service.placeOrder('u1', buy());

    expect(f.orders).toHaveLength(2);
  });

  it('records which agent turn the order acted on', async () => {
    const f = setup({ cash: 100000, ltp: 100 });

    await f.service.placeOrder('u1', {
      ...buy('order-from-agent'),
      decisionTurnId: '0197ab12cd34ef567890abcd',
    });

    // Without this link an order six weeks old is a row of numbers with no story.
    expect(f.orders[0].decisionTurnId).toBe('0197ab12cd34ef567890abcd');
  });

  it('leaves the link empty for a manually placed order', async () => {
    const f = setup({ cash: 100000, ltp: 100 });
    await f.service.placeOrder('u1', buy());
    expect(f.orders[0].decisionTurnId).toBeUndefined();
  });

  it('does not swallow a write failure that is not a duplicate key', async () => {
    const f = setup({ cash: 100000, ltp: 100 });
    f.orderModel.create.mockRejectedValueOnce(new Error('mongo is down'));

    await expect(f.service.placeOrder('u1', buy('order-x'))).rejects.toThrow(
      'mongo is down',
    );
  });
});

describe('PaperTradingService.executeOrder', () => {
  it('executes a MARKET BUY: debits cash, opens the position, records the trade', async () => {
    const f = setup({ cash: 100000, ltp: 100 });

    const res = (await f.service.placeOrder('u1', {
      symbol: 'tcs',
      exchange: 'NSE',
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity: 10,
    })) as { order: Doc; trade: Doc };

    expect(res.order.status).toBe(OrderStatus.EXECUTED);
    expect(res.order.executedPrice).toBe(100);
    expect(f.portfolio.cashBalance).toBe(99000);

    const pos = f.live()[0];
    expect(pos.symbol).toBe('TCS');
    expect(pos.quantity).toBe(10);
    expect(pos.averageCost).toBe(100);

    expect(res.trade.realisedPnl).toBe(0);
    expect(f.gateway.emitOrderUpdate).toHaveBeenCalledWith('u1', expect.anything());
    expect(f.gateway.emitPositionUpdate).toHaveBeenCalled();
  });

  it('executes a MARKET SELL: credits cash, books realised P&L, reduces the position', async () => {
    const f = setup({
      cash: 50000,
      ltp: 100,
      position: { symbol: 'TCS', quantity: 10, averageCost: 90 },
    });

    const res = (await f.service.placeOrder('u1', {
      symbol: 'TCS',
      exchange: 'NSE',
      side: OrderSide.SELL,
      type: OrderType.MARKET,
      quantity: 5,
    })) as { order: Doc; trade: Doc };

    expect(res.order.status).toBe(OrderStatus.EXECUTED);
    expect(f.portfolio.cashBalance).toBe(50500);      // +5 × 100
    expect(f.portfolio.realisedPnl).toBe(50);         // (100 − 90) × 5
    expect(res.trade.realisedPnl).toBe(50);

    const pos = f.live()[0];
    expect(pos.quantity).toBe(5);
  });

  it('closes the position entirely when the full quantity is sold', async () => {
    const f = setup({
      cash: 0,
      ltp: 120,
      position: { symbol: 'TCS', quantity: 4, averageCost: 100 },
    });

    await f.service.placeOrder('u1', {
      symbol: 'TCS',
      exchange: 'NSE',
      side: OrderSide.SELL,
      type: OrderType.MARKET,
      quantity: 4,
    });

    expect(f.live()).toHaveLength(0);
    expect(f.portfolio.cashBalance).toBe(480);
    expect(f.portfolio.realisedPnl).toBe(80);
  });

  it('rejects a BUY with insufficient cash and leaves the balance untouched', async () => {
    const f = setup({ cash: 500, ltp: 100 });

    await expect(
      f.service.placeOrder('u1', {
        symbol: 'TCS',
        exchange: 'NSE',
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        quantity: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(f.portfolio.cashBalance).toBe(500);
    expect(f.orders[0].status).toBe(OrderStatus.REJECTED);
    expect(f.orders[0].rejectionReason).toBe('Insufficient cash balance');
    expect(f.live()).toHaveLength(0);
  });

  it('rejects a SELL for more than is held', async () => {
    const f = setup({
      cash: 1000,
      ltp: 100,
      position: { symbol: 'TCS', quantity: 2, averageCost: 90 },
    });

    await expect(
      f.service.placeOrder('u1', {
        symbol: 'TCS',
        exchange: 'NSE',
        side: OrderSide.SELL,
        type: OrderType.MARKET,
        quantity: 5,
      }),
    ).rejects.toThrow('Cannot sell 5 — only 2 held');

    expect(f.portfolio.cashBalance).toBe(1000);
    expect(f.live()[0].quantity).toBe(2);
    expect(f.orders[0].status).toBe(OrderStatus.REJECTED);
  });

  it('refuses to fill a LIMIT order the market has not reached', async () => {
    // Regression guard for the bug documented in executeOrder: filling at the
    // limit unconditionally made the paper account arbitrarily inflatable.
    const f = setup({ cash: 100000, ltp: 100 });

    const res = await f.service.placeOrder('u1', {
      symbol: 'TCS',
      exchange: 'NSE',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: 10,
      limitPrice: 90,
    });

    expect(res.status).toBe(OrderStatus.PENDING);
    // Nothing has filled, so there is no executed price to report.
    expect(res.executedPrice).toBeNull();
    expect(res.requestedPrice).toBe(90);

    await expect(f.service.executeOrder(String(res.order._id))).rejects.toThrow(
      /Limit not reached/,
    );
    expect(f.portfolio.cashBalance).toBe(100000);
    expect(f.live()).toHaveLength(0);
  });

  it('fills a LIMIT order at the prevailing price once the market reaches it', async () => {
    const f = setup({ cash: 100000, ltp: 85 });

    const placed = await f.service.placeOrder('u1', {
      symbol: 'TCS',
      exchange: 'NSE',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: 10,
      limitPrice: 90,
    });

    const res = (await f.service.executeOrder(String(placed.order._id))) as { order: Doc };

    // Fills at 85 (the market), not at the 90 limit.
    expect(res.order.executedPrice).toBe(85);
    expect(f.portfolio.cashBalance).toBe(99150);
  });

  it('lets only one of two concurrent BUYs through when the cash covers just one', async () => {
    // CRIT-5: the old read-check-mutate-save let both orders pass the balance
    // check and both write, leaving the account overdrawn.
    //
    // Both orders declare a stop so the aggregate-risk cap measures their real
    // risk (₹100, 1% of the account) rather than falling back to its 5%
    // assumption, which on a ₹9,000 order against a ₹10,000 account would
    // legitimately refuse both and stop this test exercising the cash race.
    const f = setup({ cash: 10000, ltp: 900 });

    const results = await Promise.allSettled([
      f.service.placeOrder('u1', {
        symbol: 'TCS', exchange: 'NSE', side: OrderSide.BUY,
        type: OrderType.MARKET, quantity: 10, stopLoss: 890,
      }),
      f.service.placeOrder('u1', {
        symbol: 'TCS', exchange: 'NSE', side: OrderSide.BUY,
        type: OrderType.MARKET, quantity: 10, stopLoss: 890,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(f.portfolio.cashBalance).toBe(1000);
    expect(f.portfolio.cashBalance).toBeGreaterThanOrEqual(0);
  });
});

describe('PaperTradingService risk limits', () => {
  const fivePositions = [
    { symbol: 'HDFCBANK', quantity: 1, averageCost: 100, stopLoss: 99 },
    { symbol: 'ICICIBANK', quantity: 1, averageCost: 100, stopLoss: 99 },
    { symbol: 'SBIN', quantity: 1, averageCost: 100, stopLoss: 99 },
    { symbol: 'AXISBANK', quantity: 1, averageCost: 100, stopLoss: 99 },
    { symbol: 'KOTAKBANK', quantity: 1, averageCost: 100, stopLoss: 99 },
  ];

  it('refuses a sixth position and says which limit stopped it', async () => {
    const f = setup({ cash: 100000, ltp: 100, positions: fivePositions });

    await expect(
      f.service.placeOrder('u1', {
        symbol: 'TCS', exchange: 'NSE', side: OrderSide.BUY,
        type: OrderType.MARKET, quantity: 1, stopLoss: 99,
      }),
    ).rejects.toThrow(/Position limit reached: 5 open, maximum is 5/);

    // Nothing moved, and the refusal is on the record with its reason.
    expect(f.portfolio.cashBalance).toBe(100000);
    expect(f.live()).toHaveLength(5);
    expect(f.orders[0].status).toBe(OrderStatus.REJECTED);
    expect(f.orders[0].rejectionReason).toMatch(/Position limit reached/);
  });

  it('still lets a SELL through at the position cap — an exit is never blocked', async () => {
    const f = setup({
      cash: 1000,
      ltp: 120,
      positions: [...fivePositions.slice(0, 4), { symbol: 'TCS', quantity: 4, averageCost: 100 }],
    });

    const res = await f.service.placeOrder('u1', {
      symbol: 'TCS', exchange: 'NSE', side: OrderSide.SELL,
      type: OrderType.MARKET, quantity: 4,
    });

    expect(res.status).toBe(OrderStatus.EXECUTED);
    expect(f.live()).toHaveLength(4);
  });

  it('refuses an order that would push aggregate open risk past 3% of the account', async () => {
    // Open risk (100 − 68) × 100 = ₹3,200 on a ₹110,000 account = 2.91%.
    const f = setup({
      cash: 100000,
      ltp: 100,
      position: { symbol: 'INFY', quantity: 100, averageCost: 100, stopLoss: 68 },
    });

    const before = await f.service.getRiskState('u1');
    expect(before.blocked).toBe(false);
    expect(before.openRiskPct).toBeCloseTo(2.91, 1);

    // This order adds (100 − 98.5) × 100 = ₹150, taking the total to 3.05%.
    await expect(
      f.service.placeOrder('u1', {
        symbol: 'TCS', exchange: 'NSE', side: OrderSide.BUY,
        type: OrderType.MARKET, quantity: 100, stopLoss: 98.5,
      }),
    ).rejects.toThrow(/Aggregate risk limit reached/);

    expect(f.portfolio.cashBalance).toBe(100000);
  });

  it('counts a position with no declared stop at the assumed adverse move, and says so', async () => {
    // No stop on a ₹60,000 position: 5% assumed = ₹3,000 on a ₹160,000
    // account = 1.88%. The point of the assertion is that a stopless position
    // is not treated as risk-free, and that the state says the real downside
    // is not bounded at all.
    const f = setup({
      cash: 100000,
      ltp: 100,
      position: { symbol: 'INFY', quantity: 600, averageCost: 100 },
    });

    const state = await f.service.getRiskState('u1');
    expect(state.openRisk).toBe(3000);
    expect(state.positionsWithoutStop).toBe(1);
    expect(state.openRiskIsUnbounded).toBe(true);
  });

  it('blocks all new buying once the session is down 3%, and names the limit', async () => {
    const f = setup({ cash: 100000, ltp: 100, trades: [{ realisedPnl: -3500 }] });

    const state = await f.service.getRiskState('u1');
    expect(state.sessionRealisedPnl).toBe(-3500);
    expect(state.blocked).toBe(true);

    await expect(
      f.service.placeOrder('u1', {
        symbol: 'TCS', exchange: 'NSE', side: OrderSide.BUY,
        type: OrderType.MARKET, quantity: 1, stopLoss: 99,
      }),
    ).rejects.toThrow(/Daily loss limit reached/);
  });

  it('counts only losses from the current session, not every loss ever booked', async () => {
    // The same ₹3,500 loss, three days old. A lifetime total would lock the
    // account out permanently after one bad day.
    const f = setup({
      cash: 100000,
      ltp: 100,
      trades: [{ realisedPnl: -3500, executedAt: new Date(Date.now() - 3 * 86400_000) }],
    });

    const state = await f.service.getRiskState('u1');
    expect(state.sessionRealisedPnl).toBe(0);
    expect(state.blocked).toBe(false);

    const res = await f.service.placeOrder('u1', {
      symbol: 'TCS', exchange: 'NSE', side: OrderSide.BUY,
      type: OrderType.MARKET, quantity: 1, stopLoss: 99,
    });
    expect(res.status).toBe(OrderStatus.EXECUTED);
  });
});

describe('PaperTradingService.placeOrder result', () => {
  it('reports the price the order actually filled at, not the price requested', async () => {
    // The frontend was showing the limit price the user typed as though it were
    // the fill. `executedPrice` is the number that actually moved the account.
    const f = setup({ cash: 100000, ltp: 101.25 });

    const res = await f.service.placeOrder('u1', {
      symbol: 'TCS', exchange: 'NSE', side: OrderSide.BUY,
      type: OrderType.MARKET, quantity: 5,
    });

    expect(res.executedPrice).toBe(101.25);
    expect(res.requestedPrice).toBeNull();
    expect(res.status).toBe(OrderStatus.EXECUTED);
    expect(res.message).toContain('101.25');
    expect(res.trade).not.toBeNull();
  });
});

describe('PaperTradingService.squareOffAll', () => {
  it('flattens every open position and books the realised P&L', async () => {
    const f = setup({
      cash: 1000,
      ltp: 120,
      positions: [
        { symbol: 'TCS', quantity: 4, averageCost: 100 },
        { symbol: 'INFY', quantity: 2, averageCost: 110 },
      ],
    });

    const result = await f.service.squareOffAll();

    expect(result.closed).toBe(2);
    expect(result.failed).toBe(0);
    expect(f.live()).toHaveLength(0);
    expect(f.portfolio.cashBalance).toBe(1720);          // 1000 + 480 + 240
    expect(f.portfolio.realisedPnl).toBe(100);           // (120−100)×4 + (120−110)×2
    expect(result.details.every((d) => d.exitPrice === 120)).toBe(true);
  });

  it('reports a failure per position instead of abandoning the rest', async () => {
    const f = setup({
      cash: 0,
      ltpFails: true,
      positions: [{ symbol: 'TCS', quantity: 4, averageCost: 100 }],
    });

    const result = await f.service.squareOffAll();

    expect(result.closed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.details[0].error).toMatch(/Could not fetch live price/);
    expect(f.live()).toHaveLength(1);
  });
});

describe('PaperTradingService.refreshPositionPrices', () => {
  it('reports which symbols kept a stale price instead of swallowing the failure', async () => {
    const f = setup({
      cash: 0,
      ltp: 110,
      position: { symbol: 'TCS', quantity: 3, averageCost: 100 },
    });

    const ok = await f.service.refreshPositionPrices('u1');
    expect(ok.refreshed).toBe(1);
    expect(ok.stale).toBe(0);
    expect(ok.staleSymbols).toEqual([]);
    expect(f.live()[0].currentPrice).toBe(110);

    const failing = setup({
      cash: 0,
      ltpFails: true,
      position: { symbol: 'INFY', quantity: 3, averageCost: 100 },
    });

    const degraded = await failing.service.refreshPositionPrices('u1');
    expect(degraded.refreshed).toBe(0);
    expect(degraded.stale).toBe(1);
    expect(degraded.staleSymbols).toEqual(['INFY']);
  });
});
