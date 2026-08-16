import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BrokerController } from './broker.controller';
import { ZerodhaSessionService } from './zerodha-session.service';
import { ZerodhaSession, ZerodhaSessionSchema } from './schemas/zerodha-session.schema';

/** The current Zerodha Kite Connect access_token, refreshed daily. */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: ZerodhaSession.name, schema: ZerodhaSessionSchema }]),
  ],
  providers: [ZerodhaSessionService],
  controllers: [BrokerController],
})
export class BrokerModule {}
