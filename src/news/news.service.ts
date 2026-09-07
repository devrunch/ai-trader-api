import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NewsResult, NewsResultDocument } from './schemas/news-result.schema';
import { StoreNewsResultDto } from './dto/store-news-result.dto';

const LATEST = { key: 'latest' };

@Injectable()
export class NewsService {
  constructor(
    @InjectModel(NewsResult.name)
    private readonly newsModel: Model<NewsResultDocument>,
  ) {}

  /** Upsert the one singleton row -- each run_news_analysis tick replaces
   *  it rather than accumulating a history nothing reads. */
  async store(payload: StoreNewsResultDto) {
    const saved = await this.newsModel.findOneAndUpdate(
      LATEST,
      {
        ...LATEST,
        articles: payload.articles ?? [],
        count: payload.count ?? 0,
        degraded: payload.degraded ?? false,
        degradedReason: payload.degraded_reason ?? null,
      },
      { upsert: true, new: true },
    );
    return saved!;
  }

  /** A well-shaped empty result, not a 404 -- the frontend's news callers
   *  read `{articles, count}` unconditionally with no 404 branch (unlike
   *  the Brief page's own "no brief yet" special case), so failing this
   *  the same way before the very first pipeline tick would show a
   *  generic error banner instead of the honest "no news yet" empty list
   *  a fresh deployment briefly needs to render. */
  async latest() {
    const doc = await this.newsModel.findOne(LATEST).lean();
    if (!doc) {
      return { articles: [], count: 0, degraded: true, degraded_reason: 'news_unavailable' };
    }
    return {
      articles: doc.articles,
      count: doc.count,
      degraded: doc.degraded,
      degraded_reason: doc.degradedReason,
    };
  }
}
