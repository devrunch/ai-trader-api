import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { ChatBudgetService } from './chat-budget.service';
import { ChatController } from './chat.controller';
import { ChatSessionsService } from './chat-sessions.service';
import { ChatTurn, ChatTurnSchema } from './schemas/chat-turn.schema';

/**
 * Durable memory for the agent.
 *
 * Separate from SignalsModule, which proxies live turns: this module owns what
 * a turn LEFT BEHIND. The signals controller depends on it to record, and the
 * strategies tab and the "why this trade" panel read from it — three consumers
 * of one collection, which is the same argument the event stream makes upstream.
 */
@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: ChatTurn.name, schema: ChatTurnSchema }]),
  ],
  providers: [ChatSessionsService, ChatBudgetService],
  controllers: [ChatController],
  exports: [ChatSessionsService, ChatBudgetService],
})
export class ChatModule {}
