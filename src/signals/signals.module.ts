import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { Signal, SignalSchema } from './schemas/signal.schema';
import { SignalsService } from './signals.service';
import { SignalsGateway } from './signals.gateway';
import { SignalsController } from './signals.controller';
import { ChatStreamController } from './chat-stream.controller';
import { SignalsUpstreamClient } from './signals-upstream.client';

@Module({
  imports: [
    AuthModule,
    ChatModule,
    MongooseModule.forFeature([{ name: Signal.name, schema: SignalSchema }]),
  ],
  providers: [SignalsGateway, SignalsService, SignalsUpstreamClient],
  controllers: [ChatStreamController, SignalsController],
  exports: [SignalsGateway],
})
export class SignalsModule {}
