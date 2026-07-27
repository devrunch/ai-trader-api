import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SkipThrottle } from '@nestjs/throttler';
import { Server, Socket } from 'socket.io';

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
export class SignalsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SignalsGateway.name);

  constructor(private readonly jwt: JwtService) {}

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
  }

  // Client subscribes to a symbol's signal feed
  @SubscribeMessage('subscribe_symbol')
  handleSubscribeSymbol(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { symbol: string },
  ) {
    const room = `symbol:${data.symbol.toUpperCase()}`;
    client.join(room);
    client.emit('subscribed', { room });
  }

  @SubscribeMessage('unsubscribe_symbol')
  handleUnsubscribeSymbol(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { symbol: string },
  ) {
    client.leave(`symbol:${data.symbol.toUpperCase()}`);
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
