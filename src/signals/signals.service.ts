import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { createClient, RedisClientType } from 'redis';
import { Signal, SignalDocument } from './schemas/signal.schema';
import { SignalsGateway } from './signals.gateway';

@Injectable()
export class SignalsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SignalsService.name);
  private subscriber: RedisClientType;

  constructor(
    @InjectModel(Signal.name) private readonly signalModel: Model<SignalDocument>,
    private readonly config: ConfigService,
    private readonly gateway: SignalsGateway,
  ) {}

  async onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.subscriber = createClient({ url: redisUrl }) as RedisClientType;

    this.subscriber.on('error', (err) =>
      this.logger.error('Redis subscriber error', err),
    );

    await this.subscriber.connect();
    await this.subscriber.subscribe('signals:new', (message) =>
      this.handleSignal(message),
    );

    this.logger.log('Subscribed to Redis channel: signals:new');
  }

  async onModuleDestroy() {
    await this.subscriber?.quit();
  }

  private async handleSignal(raw: string) {
    try {
      const data = JSON.parse(raw);

      const signal = await this.signalModel.create({
        symbol: data.symbol,
        exchange: data.exchange ?? 'NSE',
        direction: data.direction,
        entryPrice: data.entry_price,
        targetPrice: data.target_price,
        stopLoss: data.stop_loss,
        confidence: data.confidence,
        reasoning: data.reasoning,
        indicators: data.indicators ?? {},
        generatedAt: data.generated_at ? new Date(data.generated_at) : new Date(),
      });

      this.logger.log(`Signal saved: ${signal.symbol} ${signal.direction} @ ${signal.entryPrice}`);

      // Broadcast to all connected WebSocket clients
      this.gateway.broadcastSignal(signal.toObject());
    } catch (err) {
      this.logger.error('Failed to process signal', err);
    }
  }

  async getRecentSignals(limit = 50) {
    return this.signalModel.find().sort({ createdAt: -1 }).limit(limit).lean();
  }

  async getSignalsBySymbol(symbol: string, limit = 20) {
    return this.signalModel
      .find({ symbol: symbol.toUpperCase() })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
}
