import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NewsModule } from '../news/news.module';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';

@Module({
  // For NewsService -- MarketController's news() route reads the stored
  // latest analysis directly rather than proxying live to the signals
  // service. NewsModule does not import MarketModule, so this is not a
  // cycle and needs no forwardRef.
  imports: [AuthModule, NewsModule],
  controllers: [MarketController],
  providers: [MarketService],
  exports: [MarketService],
})
export class MarketModule {}
