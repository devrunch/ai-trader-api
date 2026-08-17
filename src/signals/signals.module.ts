import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import Redis from 'ioredis';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { Signal, SignalSchema } from './schemas/signal.schema';
import { SignalsService } from './signals.service';
import { SignalsGateway } from './signals.gateway';
import { SignalsController } from './signals.controller';
import { ChatStreamController } from './chat-stream.controller';
import { SignalsUpstreamClient } from './signals-upstream.client';
import { LiveTicksInternalController } from './live-ticks-internal.controller';

@Module({
  imports: [
    AuthModule,
    ChatModule,
    MongooseModule.forFeature([{ name: Signal.name, schema: SignalSchema }]),
  ],
  providers: [
    SignalsGateway,
    SignalsService,
    SignalsUpstreamClient,
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379/0'),
    },
  ],
  controllers: [ChatStreamController, SignalsController, LiveTicksInternalController],
  exports: [SignalsGateway],
})
export class SignalsModule {}
