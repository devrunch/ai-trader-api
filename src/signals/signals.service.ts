import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { Signal, SignalDocument } from './schemas/signal.schema';
import { SignalsGateway } from './signals.gateway';

@Injectable()
export class SignalsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SignalsService.name);
  private sqs: SQSClient;
  private queueUrl: string;
  private polling = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(Signal.name) private readonly signalModel: Model<SignalDocument>,
    private readonly config: ConfigService,
    private readonly gateway: SignalsGateway,
  ) {}

  onModuleInit() {
    this.queueUrl = this.config.get<string>('SQS_SIGNALS_QUEUE_URL') ?? '';
    if (!this.queueUrl) {
      this.logger.warn('SQS_SIGNALS_QUEUE_URL not set — signal polling disabled');
      return;
    }

    this.sqs = new SQSClient({
      region: this.config.get<string>('AWS_REGION') ?? 'ap-south-1',
      credentials: {
        accessKeyId: this.config.get<string>('AWS_ACCESS_KEY_ID') ?? '',
        secretAccessKey: this.config.get<string>('AWS_SECRET_ACCESS_KEY') ?? '',
      },
    });

    this.polling = true;
    this.poll();
    this.logger.log('SQS signal poller started');
  }

  onModuleDestroy() {
    this.polling = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  private async poll() {
    if (!this.polling) return;

    try {
      const result = await this.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,       // long-poll — reduces cost vs busy-loop
          VisibilityTimeout: 30,
        }),
      );

      const messages = result.Messages ?? [];
      await Promise.all(messages.map((msg) => this.handleMessage(msg)));
    } catch (err) {
      this.logger.error('SQS poll error', err);
      // back off 5s on error, then resume
      await new Promise((r) => setTimeout(r, 5000));
    }

    // schedule next poll immediately (long-poll already waits 20s server-side)
    if (this.polling) {
      this.pollTimer = setTimeout(() => this.poll(), 0);
    }
  }

  private async handleMessage(msg: { Body?: string; ReceiptHandle?: string }) {
    try {
      const data = JSON.parse(msg.Body ?? '{}');

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

      this.logger.log(
        `Signal saved: ${signal.symbol} ${signal.direction} @ ${signal.entryPrice}`,
      );

      this.gateway.broadcastSignal(signal.toObject());

      // delete from queue only after successful processing
      await this.sqs.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: msg.ReceiptHandle!,
        }),
      );
    } catch (err) {
      this.logger.error('Failed to process signal message', err);
      // message becomes visible again after VisibilityTimeout — automatic retry
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
