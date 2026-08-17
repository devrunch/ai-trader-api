import { SignalsGateway } from './signals.gateway';

/*
 * The watcher-count transition detection is the genuinely new piece of logic
 * here: exactly one internal call on the FIRST watcher of a (symbol, exchange)
 * pair, and on the LAST one leaving — tracked per pair, not per room.
 */

// `join`/`leave` mutate the shared fake `rooms` map exactly like real
// Socket.IO does — `join` adds the socket's id to the room's Set (creating
// it if needed), `leave` removes it (a no-op if the socket wasn't a
// member). Tests rely on this real mutation instead of manually poking the
// rooms map, so a duplicate/non-member `leave()` behaves the same way it
// would in production.
function fakeSocket(id: string, rooms: Map<string, Set<string>>, data: Record<string, unknown> = {}) {
  return {
    id,
    data,
    join: jest.fn((room: string) => {
      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room)!.add(id);
    }),
    leave: jest.fn((room: string) => {
      rooms.get(room)?.delete(id);
    }),
    emit: jest.fn(),
  } as any;
}

function fakeRoomsMap() {
  const rooms = new Map<string, Set<string>>();
  return {
    rooms,
    adapter: { rooms },
  };
}

describe('SignalsGateway live-tick subscriptions', () => {
  function setup() {
    const jwt = { verifyAsync: jest.fn() } as any;
    const redisClient = { subscribe: jest.fn().mockResolvedValue(undefined), on: jest.fn(), publish: jest.fn(), disconnect: jest.fn() };
    const httpClient = { request: jest.fn().mockResolvedValue(undefined) };
    const gateway = new SignalsGateway(jwt, redisClient as any, httpClient as any);
    const fakeServer = fakeRoomsMap();
    (gateway as any).server = { ...fakeServer, to: jest.fn().mockReturnThis(), emit: jest.fn(), sockets: fakeServer };
    return { gateway, httpClient, fakeServer, redisClient };
  }

  it('calls internal subscribe only for the first watcher of a (symbol, exchange) pair', () => {
    const { gateway, httpClient, fakeServer } = setup();
    const client = fakeSocket('s1', fakeServer.rooms);

    gateway.handleSubscribeSymbol(client, { symbol: 'RELIANCE', exchange: 'NSE' });

    expect(httpClient.request).toHaveBeenCalledTimes(1);
    expect(httpClient.request).toHaveBeenCalledWith(
      '/market/internal/live-ticks/subscribe',
      expect.objectContaining({ method: 'POST', body: { symbol: 'RELIANCE', exchange: 'NSE' } }),
    );
  });

  it('does not call internal subscribe for the second watcher of the same pair', () => {
    const { gateway, httpClient, fakeServer } = setup();
    gateway.handleSubscribeSymbol(fakeSocket('s1', fakeServer.rooms), { symbol: 'RELIANCE', exchange: 'NSE' });
    httpClient.request.mockClear();

    gateway.handleSubscribeSymbol(fakeSocket('s2', fakeServer.rooms), { symbol: 'RELIANCE', exchange: 'NSE' });

    expect(httpClient.request).not.toHaveBeenCalled();
  });

  it('calls internal unsubscribe only when the last watcher of a pair leaves', () => {
    const { gateway, httpClient, fakeServer } = setup();
    const client = fakeSocket('s1', fakeServer.rooms);
    gateway.handleSubscribeSymbol(client, { symbol: 'RELIANCE', exchange: 'NSE' });
    httpClient.request.mockClear();

    gateway.handleUnsubscribeSymbol(client, { symbol: 'RELIANCE', exchange: 'NSE' });

    expect(httpClient.request).toHaveBeenCalledWith(
      '/market/internal/live-ticks/unsubscribe',
      expect.objectContaining({ method: 'POST', body: { symbol: 'RELIANCE', exchange: 'NSE' } }),
    );
  });

  it('does not call internal unsubscribe while other watchers of the pair remain', () => {
    const { gateway, httpClient, fakeServer } = setup();
    const clientA = fakeSocket('s1', fakeServer.rooms);
    const clientB = fakeSocket('s2', fakeServer.rooms);
    gateway.handleSubscribeSymbol(clientA, { symbol: 'RELIANCE', exchange: 'NSE' });
    gateway.handleSubscribeSymbol(clientB, { symbol: 'RELIANCE', exchange: 'NSE' });
    httpClient.request.mockClear();

    gateway.handleUnsubscribeSymbol(clientA, { symbol: 'RELIANCE', exchange: 'NSE' });

    expect(httpClient.request).not.toHaveBeenCalled();
  });

  it('does not spuriously unsubscribe a genuine remaining watcher on a duplicate/non-member unsubscribe event', () => {
    // Regression test: client A and B both watch RELIANCE/NSE. A unsubscribes
    // normally (correct: B remains, no internal call). If A's
    // `unsubscribe_symbol` fires again — a duplicate client event, reconnect
    // cleanup, or a React effect double-invoke — the pair's count must not go
    // negative, and B's feed must NOT be killed.
    const { gateway, httpClient, fakeServer } = setup();
    const clientA = fakeSocket('a', fakeServer.rooms);
    const clientB = fakeSocket('b', fakeServer.rooms);
    gateway.handleSubscribeSymbol(clientA, { symbol: 'RELIANCE', exchange: 'NSE' });
    gateway.handleSubscribeSymbol(clientB, { symbol: 'RELIANCE', exchange: 'NSE' });
    httpClient.request.mockClear();

    gateway.handleUnsubscribeSymbol(clientA, { symbol: 'RELIANCE', exchange: 'NSE' });
    expect(httpClient.request).not.toHaveBeenCalled();

    gateway.handleUnsubscribeSymbol(clientA, { symbol: 'RELIANCE', exchange: 'NSE' });
    expect(httpClient.request).not.toHaveBeenCalled();

    expect(fakeServer.rooms.get('symbol:RELIANCE')).toEqual(new Set(['b']));
    expect(gateway.getActiveSymbols()).toEqual([{ symbol: 'RELIANCE', exchange: 'NSE' }]);
  });

  it('getActiveSymbols returns every (symbol, exchange) pair with a live watcher', () => {
    const { gateway, fakeServer } = setup();
    gateway.handleSubscribeSymbol(fakeSocket('s1', fakeServer.rooms), { symbol: 'RELIANCE', exchange: 'NSE' });

    const active = gateway.getActiveSymbols();

    expect(active).toEqual([{ symbol: 'RELIANCE', exchange: 'NSE' }]);
  });

  it('two clients watching the same symbol on two different exchanges each trigger their own subscribe, and both pairs are active', () => {
    const { gateway, httpClient, fakeServer } = setup();
    const clientNse = fakeSocket('s1', fakeServer.rooms);
    const clientBse = fakeSocket('s2', fakeServer.rooms);

    gateway.handleSubscribeSymbol(clientNse, { symbol: 'RELIANCE', exchange: 'NSE' });
    gateway.handleSubscribeSymbol(clientBse, { symbol: 'RELIANCE', exchange: 'BSE' });

    expect(httpClient.request).toHaveBeenCalledTimes(2);
    expect(httpClient.request).toHaveBeenCalledWith(
      '/market/internal/live-ticks/subscribe',
      expect.objectContaining({ body: { symbol: 'RELIANCE', exchange: 'NSE' } }),
    );
    expect(httpClient.request).toHaveBeenCalledWith(
      '/market/internal/live-ticks/subscribe',
      expect.objectContaining({ body: { symbol: 'RELIANCE', exchange: 'BSE' } }),
    );
    expect(gateway.getActiveSymbols().sort((a, b) => a.exchange.localeCompare(b.exchange))).toEqual([
      { symbol: 'RELIANCE', exchange: 'BSE' },
      { symbol: 'RELIANCE', exchange: 'NSE' },
    ]);
  });

  it('a client disconnecting without unsubscribing triggers internal unsubscribe once its pair reaches zero watchers', () => {
    const { gateway, httpClient, fakeServer } = setup();
    const client = fakeSocket('s1', fakeServer.rooms);
    gateway.handleSubscribeSymbol(client, { symbol: 'RELIANCE', exchange: 'NSE' });
    httpClient.request.mockClear();

    gateway.handleDisconnect(client);

    expect(httpClient.request).toHaveBeenCalledWith(
      '/market/internal/live-ticks/unsubscribe',
      expect.objectContaining({ body: { symbol: 'RELIANCE', exchange: 'NSE' } }),
    );
    expect(gateway.getActiveSymbols()).toEqual([]);
  });

  it('a client disconnecting does not trigger internal unsubscribe while another client still watches the same pair', () => {
    const { gateway, httpClient, fakeServer } = setup();
    const clientA = fakeSocket('a', fakeServer.rooms);
    const clientB = fakeSocket('b', fakeServer.rooms);
    gateway.handleSubscribeSymbol(clientA, { symbol: 'RELIANCE', exchange: 'NSE' });
    gateway.handleSubscribeSymbol(clientB, { symbol: 'RELIANCE', exchange: 'NSE' });
    httpClient.request.mockClear();

    gateway.handleDisconnect(clientA);

    expect(httpClient.request).not.toHaveBeenCalled();
    expect(gateway.getActiveSymbols()).toEqual([{ symbol: 'RELIANCE', exchange: 'NSE' }]);
  });

  it('subscribing to the same symbol under a different exchange decrements the old pair and increments the new one', () => {
    const { gateway, httpClient, fakeServer } = setup();
    const client = fakeSocket('s1', fakeServer.rooms);
    gateway.handleSubscribeSymbol(client, { symbol: 'RELIANCE', exchange: 'NSE' });
    httpClient.request.mockClear();

    gateway.handleSubscribeSymbol(client, { symbol: 'RELIANCE', exchange: 'BSE' });

    expect(httpClient.request).toHaveBeenCalledWith(
      '/market/internal/live-ticks/unsubscribe',
      expect.objectContaining({ body: { symbol: 'RELIANCE', exchange: 'NSE' } }),
    );
    expect(httpClient.request).toHaveBeenCalledWith(
      '/market/internal/live-ticks/subscribe',
      expect.objectContaining({ body: { symbol: 'RELIANCE', exchange: 'BSE' } }),
    );
    expect(gateway.getActiveSymbols()).toEqual([{ symbol: 'RELIANCE', exchange: 'BSE' }]);
  });

  it('ignores a subscribe_symbol message missing exchange without throwing', () => {
    const { gateway, httpClient, fakeServer } = setup();
    const client = fakeSocket('s1', fakeServer.rooms);

    expect(() => gateway.handleSubscribeSymbol(client, { symbol: 'RELIANCE' } as any)).not.toThrow();
    expect(httpClient.request).not.toHaveBeenCalled();
    expect(gateway.getActiveSymbols()).toEqual([]);
  });

  it('ignores an unsubscribe_symbol message missing exchange without throwing', () => {
    const { gateway, httpClient, fakeServer } = setup();
    const client = fakeSocket('s1', fakeServer.rooms);
    gateway.handleSubscribeSymbol(client, { symbol: 'RELIANCE', exchange: 'NSE' });
    httpClient.request.mockClear();

    expect(() => gateway.handleUnsubscribeSymbol(client, { symbol: 'RELIANCE' } as any)).not.toThrow();
    expect(httpClient.request).not.toHaveBeenCalled();
    expect(gateway.getActiveSymbols()).toEqual([{ symbol: 'RELIANCE', exchange: 'NSE' }]);
  });

  it('relays a Redis market:ticks message to the matching symbol room', () => {
    const { gateway } = setup();

    (gateway as any).handleRedisMessage('market:ticks', JSON.stringify({ symbol: 'RELIANCE', ltp: 1310 }));

    expect((gateway as any).server.to).toHaveBeenCalledWith('symbol:RELIANCE');
    expect((gateway as any).server.emit).toHaveBeenCalledWith('tick', { symbol: 'RELIANCE', ltp: 1310 });
  });

  it('does not throw on a malformed (non-JSON) market:ticks message', () => {
    const { gateway } = setup();

    expect(() => (gateway as any).handleRedisMessage('market:ticks', '{not valid json')).not.toThrow();
    expect((gateway as any).server.emit).not.toHaveBeenCalled();
  });

  it('does not emit for a market:ticks message with no symbol field', () => {
    const { gateway } = setup();

    (gateway as any).handleRedisMessage('market:ticks', JSON.stringify({ ltp: 1310 }));

    expect((gateway as any).server.emit).not.toHaveBeenCalled();
  });

  it('registers an error handler on the Redis client and disconnects it on module destroy', () => {
    const { gateway, redisClient } = setup();

    expect(redisClient.on).toHaveBeenCalledWith('error', expect.any(Function));

    gateway.onModuleDestroy();

    expect(redisClient.disconnect).toHaveBeenCalledTimes(1);
  });
});
