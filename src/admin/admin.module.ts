import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { ChatTurn, ChatTurnSchema } from '../chat/schemas/chat-turn.schema';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * Reads `ChatModule` for `ChatBudgetService` (the one source of what a cap
 * means and what the platform default is) and registers `ChatTurn` again here
 * because Mongoose feature registration is per-module, not global — importing
 * `ChatModule` gets its exported services, not its models.
 */
@Module({
  imports: [
    AuthModule,
    ChatModule,
    MongooseModule.forFeature([{ name: ChatTurn.name, schema: ChatTurnSchema }]),
  ],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
