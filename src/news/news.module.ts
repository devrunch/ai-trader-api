import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NewsResult, NewsResultSchema } from './schemas/news-result.schema';
import { NewsService } from './news.service';
import { NewsInternalController } from './news.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: NewsResult.name, schema: NewsResultSchema }]),
  ],
  controllers: [NewsInternalController],
  providers: [NewsService],
  // MarketController reads the latest result directly via NewsService.
  exports: [NewsService],
})
export class NewsModule {}
