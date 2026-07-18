import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketController } from './market.controller';

@Module({
  imports: [AuthModule],
  controllers: [MarketController],
})
export class MarketModule {}
