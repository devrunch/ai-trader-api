import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Signal, SignalSchema } from './schemas/signal.schema';
import { SignalsService } from './signals.service';
import { SignalsGateway } from './signals.gateway';
import { SignalsController } from './signals.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: Signal.name, schema: SignalSchema }]),
  ],
  providers: [SignalsGateway, SignalsService],
  controllers: [SignalsController],
  exports: [SignalsGateway],
})
export class SignalsModule {}
