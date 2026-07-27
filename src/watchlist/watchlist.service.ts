import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WatchlistItem, WatchlistItemDocument } from './schemas/watchlist-item.schema';

const MAX_WATCHLIST_SIZE = 15;
const SYMBOL_RE = /^[A-Z0-9^._-]{1,20}$/;

@Injectable()
export class WatchlistService {
  constructor(
    @InjectModel(WatchlistItem.name) private readonly model: Model<WatchlistItemDocument>,
  ) {}

  async list(userId: string) {
    return this.model.find({ userId }).sort({ createdAt: 1 }).lean();
  }

  async add(userId: string, symbol: string, exchange = 'NSE') {
    const sym = symbol.trim().toUpperCase();
    const exch = exchange.trim().toUpperCase();
    if (!SYMBOL_RE.test(sym)) {
      throw new BadRequestException(`Invalid symbol: ${symbol}`);
    }

    const count = await this.model.countDocuments({ userId });
    if (count >= MAX_WATCHLIST_SIZE) {
      throw new BadRequestException(`Watchlist is limited to ${MAX_WATCHLIST_SIZE} symbols`);
    }

    try {
      return await this.model.create({ userId, symbol: sym, exchange: exch });
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictException(`${sym} is already in your watchlist`);
      }
      throw err;
    }
  }

  async remove(userId: string, symbol: string, exchange = 'NSE') {
    const res = await this.model.deleteOne({
      userId,
      symbol: symbol.trim().toUpperCase(),
      exchange: exchange.trim().toUpperCase(),
    });
    return { removed: res.deletedCount > 0 };
  }

  /**
   * Internal, service-to-service only — the union of every user's watchlist,
   * deduplicated by symbol+exchange. Called by the Python screener before each
   * run so it scans exactly what's being watched, not a hardcoded list.
   */
  async compiledUnion(): Promise<{ symbol: string; exchange: string }[]> {
    const rows = await this.model.aggregate([
      { $group: { _id: { symbol: '$symbol', exchange: '$exchange' } } },
      { $project: { _id: 0, symbol: '$_id.symbol', exchange: '$_id.exchange' } },
    ]);
    return rows;
  }
}
