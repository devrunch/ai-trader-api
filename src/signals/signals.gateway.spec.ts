import { SignalsGateway } from './signals.gateway';

/*
 * The room-transition detection is the one genuinely new piece of logic
 * here: exactly one internal call on the FIRST watcher joining and the
 * LAST one leaving, none in between.
 */

function fakeSocket(id: string, data: Record<string, unknown> = {}) {
  return { id, data, join: jest.fn(), leave: jest.fn(), emit: jest.fn() } as any;
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
    const redisClient = { subscribe: jest.fn(), on: jest.fn(), publish: jest.fn() };
    const httpClient = { request: jest.fn().mockResolvedValue(undefined) };
    const gateway = new SignalsGateway(jwt, redisClient as any, httpClient as any);
    const fakeServer = fakeRoomsMap();
    (gateway as any).server = { ...fakeServer, to: jest.fn().mockReturnThis(), emit: jest.fn(), sockets: fakeServer };
    return { gateway, httpClient, fakeServer };
  }

  it('calls internal subscribe only when the room gains its first member', () => {
    const { gateway, httpClient, fakeServer } = setup();
    fakeServer.rooms.set('symbol:RELIANCE', new Set());
    const client = fakeSocket('s1');

    gateway.handleSubscribeSymbol(client, { symbol: 'RELIANCE', exchange: 'NSE' });
    fakeServer.rooms.get('symbol:RELIANCE')!.add('s1');

    expect(httpClient.request).toHaveBeenCalledTimes(1);
    expect(httpClient.request).toHaveBeenCalledWith(
      '/market/internal/live-ticks/subscribe',
      expect.objectContaining({ method: 'POST', body: { symbol: 'RELIANCE', exchange: 'NSE' } }),
    );
  });

  it('does not call internal subscribe for the second watcher of the same room', () => {
    const { gateway, httpClient, fakeServer } = setup();
    fakeServer.rooms.set('symbol:RELIANCE', new Set(['s1']));

    gateway.handleSubscribeSymbol(fakeSocket('s2'), { symbol: 'RELIANCE', exchange: 'NSE' });
    fakeServer.rooms.get('symbol:RELIANCE')!.add('s2');

    expect(httpClient.request).not.toHaveBeenCalled();
  });

  it('calls internal unsubscribe only when the last watcher leaves', () => {
    const { gateway, httpClient, fakeServer } = setup();
    fakeServer.rooms.set('symbol:RELIANCE', new Set(['s1']));

    gateway.handleUnsubscribeSymbol(fakeSocket('s1'), { symbol: 'RELIANCE', exchange: 'NSE' });
    fakeServer.rooms.delete('symbol:RELIANCE');

    expect(httpClient.request).toHaveBeenCalledWith(
      '/market/internal/live-ticks/unsubscribe',
      expect.objectContaining({ method: 'POST', body: { symbol: 'RELIANCE', exchange: 'NSE' } }),
    );
  });

  it('does not call internal unsubscribe while other watchers remain', () => {
    const { gateway, httpClient, fakeServer } = setup();
    fakeServer.rooms.set('symbol:RELIANCE', new Set(['s1', 's2']));

    gateway.handleUnsubscribeSymbol(fakeSocket('s1'), { symbol: 'RELIANCE', exchange: 'NSE' });
    fakeServer.rooms.get('symbol:RELIANCE')!.delete('s1');

    expect(httpClient.request).not.toHaveBeenCalled();
  });

  it('getActiveSymbols returns every non-empty symbol room with its exchange', () => {
    const { gateway, fakeServer } = setup();
    fakeServer.rooms.set('symbol:RELIANCE', new Set(['s1']));
    fakeServer.rooms.set('symbol:TCS', new Set());
    fakeServer.rooms.set('user:abc123', new Set(['s1']));
    gateway.handleSubscribeSymbol(fakeSocket('s1'), { symbol: 'RELIANCE', exchange: 'NSE' });

    const active = gateway.getActiveSymbols();

    expect(active).toEqual([{ symbol: 'RELIANCE', exchange: 'NSE' }]);
  });

  it('relays a Redis market:ticks message to the matching symbol room', () => {
    const { gateway } = setup();

    (gateway as any).handleRedisMessage('market:ticks', JSON.stringify({ symbol: 'RELIANCE', ltp: 1310 }));

    expect((gateway as any).server.to).toHaveBeenCalledWith('symbol:RELIANCE');
    expect((gateway as any).server.emit).toHaveBeenCalledWith('tick', { symbol: 'RELIANCE', ltp: 1310 });
  });
});
