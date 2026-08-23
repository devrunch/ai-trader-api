import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SkipThrottle } from '@nestjs/throttler';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { UpstreamHttpClient } from '../common/http/upstream-http.client';

/** What the browser reports over the chart_state event -- the frontend's
 *  own AttachedIndicator shape, opaque here (this gateway never interprets
 *  an entry, only relays the whole thing to the chat agent). */
export interface ChartState {
  interval?: string;
  indicators: unknown[];
}

/** Bound the payload a client can push -- the chart-layouts DTO caps
 *  indicators at 20 for the same reason (a runaway client must not grow
 *  server-side state without limit); this is in-memory per user rather
 *  than a database row, so the bound matters just as much. */
const MAX_CHART_STATE_INDICATORS = 20;

/** Minimal cookie-header parser — avoids pulling a dependency for one field. */
function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// The global APP_GUARD ThrottlerGuard also runs for @SubscribeMessage handlers,
// where it would call `res.header(...)` on a socket.io Socket and throw. WS
// message volume is not the cost sink the throttler exists for, so skip it.
@SkipThrottle()
@WebSocketGateway({
  // Mirrors the HTTP CORS policy in main.ts. `origin: '*'` with
  // `credentials: true` is invalid per the CORS spec anyway, and it let the
  // gateway bypass the app's origin policy entirely. Read from process.env
  // rather than ConfigService because decorator metadata is evaluated at module
  // load, before the DI container exists.
  cors: {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/',
})
export class SignalsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SignalsGateway.name);
  // key: `${symbol}:${exchange}` -> count of distinct clients currently watching
  // that pair. Independent of the `symbol:${symbol}` Socket.IO room (which stays
  // exchange-agnostic for tick delivery and broadcastSignal compatibility) — this
  // is what drives Python's per-exchange subscribe/unsubscribe lifecycle, since
  // the same symbol can legitimately trade on more than one exchange (RELIANCE on
  // both NSE and BSE) with independent watchers.
  private readonly watcherCounts = new Map<string, number>();
  // key: client.id -> Map<symbol, exchange> — what THIS client currently watches,
  // so a disconnect can decrement correctly without relying on Socket.IO's own
  // room state, which may already be cleared by the time the disconnect event fires.
  private readonly clientWatching = new Map<string, Map<string, string>>();
  // key: userId -> what the browser last reported attached to the chart
  // (interval + the AttachedIndicator array, opaque here same as `drawings`
  // in ChartLayout — this gateway never interprets it, only relays it to the
  // chat agent so its chart_indicators tools have real data instead of none
  // at all). Kept across a brief disconnect/reconnect rather than cleared —
  // a network blip should not make the agent forget what's on the chart a
  // few seconds later.
  private readonly chartStateByUser = new Map<string, ChartState>();

  constructor(
    private readonly jwt: JwtService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly upstream: UpstreamHttpClient,
  ) {
    this.redis.on('error', (err) => this.logger.error(`Redis client error: ${err.message}`));
    this.redis.subscribe('market:ticks').catch((err: Error) =>
      this.logger.error(`Failed to subscribe to market:ticks: ${err.message}`),
    );
    this.redis.on('message', (channel, message) => this.handleRedisMessage(channel, message));
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  /**
   * Authenticate on connect, not on join.
   *
   * The room used to come from a client-supplied `join` payload with no
   * verification, so any connected client could subscribe to any user's order
   * and position stream simply by knowing (or guessing) their id. The server
   * now derives the room from the verified JWT and there is no join handler.
   */
  async handleConnection(client: Socket) {
    const token = parseCookies(client.handshake.headers.cookie)['access_token'];
    if (!token) {
      this.logger.warn(`Rejected unauthenticated socket ${client.id}`);
      client.disconnect();
      return;
    }

    const payload = await this.jwt
      .verifyAsync<{ sub?: string }>(token)
      .catch(() => null);

    if (!payload?.sub) {
      this.logger.warn(`Rejected socket ${client.id} — invalid token`);
      client.disconnect();
      return;
    }

    client.data.userId = payload.sub;
    client.join(`user:${payload.sub}`);   // server decides the room, not the client
    this.logger.log(`Client connected: ${client.id} (user ${payload.sub})`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const watching = this.clientWatching.get(client.id);
    this.clientWatching.delete(client.id);
    if (!watching) return;
    for (const [symbol, exchange] of watching) {
      this.decrementWatcher(symbol, exchange);
    }
  }

  // Client subscribes to a symbol's signal feed
  @SubscribeMessage('subscribe_symbol')
  handleSubscribeSymbol(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { symbol?: string; exchange?: string },
  ) {
    if (!data?.symbol || !data?.exchange) {
      this.logger.warn(`Malformed subscribe_symbol from ${client.id}: ${JSON.stringify(data)}`);
      return;
    }
    const symbol = data.symbol.toUpperCase();
    const exchange = data.exchange.toUpperCase();
    const room = `symbol:${symbol}`;
    client.join(room);
    client.emit('subscribed', { room });

    let watching = this.clientWatching.get(client.id);
    if (!watching) {
      watching = new Map();
      this.clientWatching.set(client.id, watching);
    }

    const previousExchange = watching.get(symbol);
    if (previousExchange === exchange) return; // already watching this exact pair
    if (previousExchange) {
      this.decrementWatcher(symbol, previousExchange); // switching exchanges on the same symbol
    }

    watching.set(symbol, exchange);
    const pairKey = `${symbol}:${exchange}`;
    const count = (this.watcherCounts.get(pairKey) ?? 0) + 1;
    this.watcherCounts.set(pairKey, count);
    if (count === 1) {
      this.callInternal('subscribe', symbol, exchange);
    }
  }

  /**
   * The frontend's real-time report of what's attached to the chart --
   * emitted whenever the user's own indicators state changes, and once on
   * connect. `client.data.userId` comes from the verified JWT set in
   * handleConnection, never from the payload -- a chart_state event can
   * only ever update the sending user's own state.
   */
  @SubscribeMessage('chart_state')
  handleChartState(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { interval?: string; indicators?: unknown[] },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return; // handleConnection already rejects any socket without one
    const indicators = Array.isArray(data?.indicators)
      ? data.indicators.slice(0, MAX_CHART_STATE_INDICATORS)
      : [];
    this.chartStateByUser.set(userId, { interval: data?.interval, indicators });
  }

  /** What the chat controllers read before forwarding a turn upstream --
   *  see ChatStreamController/SignalsController. Undefined for a user who
   *  hasn't connected this session, or whose client is too old to emit
   *  chart_state; callers treat that as "nothing attached", not an error. */
  getChartState(userId: string): ChartState | undefined {
    return this.chartStateByUser.get(userId);
  }

  @SubscribeMessage('unsubscribe_symbol')
  handleUnsubscribeSymbol(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { symbol?: string; exchange?: string },
  ) {
    if (!data?.symbol || !data?.exchange) {
      this.logger.warn(`Malformed unsubscribe_symbol from ${client.id}: ${JSON.stringify(data)}`);
      return;
    }
    const symbol = data.symbol.toUpperCase();
    const exchange = data.exchange.toUpperCase();
    const room = `symbol:${symbol}`;
    client.leave(room);

    // Guarded by our own bookkeeping rather than `leave()`'s no-op behavior
    // (unlike the old room-based check): a duplicate/stale unsubscribe for a
    // pair this client isn't tracked as watching must not decrement a real
    // remaining watcher's count.
    const watching = this.clientWatching.get(client.id);
    if (watching?.get(symbol) !== exchange) return;
    watching.delete(symbol);
    this.decrementWatcher(symbol, exchange);
  }

  private decrementWatcher(symbol: string, exchange: string) {
    const pairKey = `${symbol}:${exchange}`;
    const count = this.watcherCounts.get(pairKey) ?? 0;
    if (count <= 1) {
      this.watcherCounts.delete(pairKey);
      this.callInternal('unsubscribe', symbol, exchange);
    } else {
      this.watcherCounts.set(pairKey, count - 1);
    }
  }

  private callInternal(action: 'subscribe' | 'unsubscribe', symbol: string, exchange: string) {
    this.upstream
      .request(`/market/internal/live-ticks/${action}`, {
        method: 'POST',
        body: { symbol, exchange },
        retryOnNetworkError: true,
      })
      .catch((e: Error) => this.logger.error(`live-ticks ${action} failed for ${symbol}: ${e.message}`));
  }

  private handleRedisMessage(channel: string, message: string) {
    if (channel !== 'market:ticks' || !this.server) return;
    let payload: { symbol?: string };
    try {
      payload = JSON.parse(message);
    } catch (e) {
      this.logger.warn(`Malformed market:ticks message: ${(e as Error).message}`);
      return;
    }
    if (!payload?.symbol) return;
    this.server.to(`symbol:${payload.symbol}`).emit('tick', payload);
  }

  getActiveSymbols(): { symbol: string; exchange: string }[] {
    return Array.from(this.watcherCounts.keys()).map((pairKey) => {
      const idx = pairKey.lastIndexOf(':');
      return { symbol: pairKey.slice(0, idx), exchange: pairKey.slice(idx + 1) };
    });
  }

  // Called by SignalsService when a new signal arrives from the SQS queue.
  // Takes `object` rather than `Record<string, unknown>` so hydrated Mongoose
  // documents can be passed without a cast at every call site.
  broadcastSignal(signal: object) {
    // `server` is undefined until the adapter is attached — in the Lambda
    // deployment the SQS handler runs with no listening HTTP server at all.
    if (!this.server) return;

    // Broadcast to all clients
    this.server.emit('signal', signal);

    // Also emit to symbol-specific room
    const symbol = (signal as { symbol?: unknown }).symbol;
    if (symbol) {
      this.server.to(`symbol:${String(symbol)}`).emit('signal', signal);
    }
  }

  // Called by PaperTradingService after order execution
  emitOrderUpdate(userId: string, order: object) {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit('order_update', order);
  }

  // Called by PaperTradingService whenever a user's positions change
  emitPositionUpdate(userId: string, positions: object[]) {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit('positions_update', positions);
  }
}
