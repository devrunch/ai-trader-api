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
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/',
})
export class SignalsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SignalsGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // Client joins their personal room to receive targeted events
  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    client.join(`user:${data.userId}`);
    client.emit('joined', { room: `user:${data.userId}` });
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

  // Called by SignalsService when a new signal arrives from Redis
  broadcastSignal(signal: Record<string, any>) {
    // Broadcast to all clients
    this.server.emit('signal', signal);

    // Also emit to symbol-specific room
    if (signal.symbol) {
      this.server.to(`symbol:${signal.symbol}`).emit('signal', signal);
    }
  }

  // Called by PaperTradingService after order execution
  emitOrderUpdate(userId: string, order: Record<string, any>) {
    this.server.to(`user:${userId}`).emit('order_update', order);
  }

  // Called when position prices refresh
  emitPositionUpdate(userId: string, positions: Record<string, any>[]) {
    this.server.to(`user:${userId}`).emit('positions_update', positions);
  }
}
