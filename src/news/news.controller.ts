import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';
import { NewsService } from './news.service';
import { StoreNewsResultDto } from './dto/store-news-result.dto';

/**
 * Internal, service-to-service only -- the Python signals service's
 * run_news_analysis task posts here every 15 min. Shared-secret gated,
 * same pattern as BriefInternalController; never expose publicly. The
 * public read path is MarketController's existing GET /market/news,
 * which now reads the stored result via NewsService directly rather than
 * proxying live to the signals service.
 */
@SkipThrottle()
@UseGuards(InternalKeyGuard)
@Controller('internal/news')
export class NewsInternalController {
  constructor(private readonly news: NewsService) {}

  @Post()
  async store(@Body() payload: StoreNewsResultDto) {
    const saved = await this.news.store(payload);
    return { ok: true, count: saved.count };
  }
}
