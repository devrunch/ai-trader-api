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
