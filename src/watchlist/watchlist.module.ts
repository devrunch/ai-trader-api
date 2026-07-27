import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { WatchlistItem, WatchlistItemSchema } from './schemas/watchlist-item.schema';
import { WatchlistService } from './watchlist.service';
import { WatchlistController, WatchlistInternalController } from './watchlist.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: WatchlistItem.name, schema: WatchlistItemSchema }]),
  ],
  controllers: [WatchlistController, WatchlistInternalController],
  providers: [WatchlistService],
  exports: [WatchlistService],
})
export class WatchlistModule {}
