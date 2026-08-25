import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SaveLayoutDto } from './dto/save-layout.dto';
import { AttachedIndicator, ChartLayout, ChartLayoutDocument } from './schemas/chart-layout.schema';

export interface LayoutView {
  symbol: string;
  exchange: string;
  drawings: Record<string, unknown>[];
  indicators: AttachedIndicator[];
  chartType?: string;
  version: number;
  updatedAt: Date | null;
}

/** An empty chart, in the same shape a saved one has. */
function blank(symbol: string, exchange = 'NSE'): LayoutView {
  return { symbol, exchange, drawings: [], indicators: [], version: 0, updatedAt: null };
}

@Injectable()
export class ChartLayoutsService {
  constructor(
    @InjectModel(ChartLayout.name)
    private readonly layoutModel: Model<ChartLayoutDocument>,
  ) {}

  /**
   * The saved chart for a symbol, or an empty one.
   *
   * Never 404: "you have not drawn on this chart yet" is a normal state, not a
   * missing resource, and making the client branch on it would mean every
   * caller reimplementing the empty case.
   */
  async get(userId: string, symbol: string): Promise<LayoutView> {
    const doc = await this.layoutModel.findOne({ userId, symbol: symbol.toUpperCase() }).lean();
    if (!doc) return blank(symbol.toUpperCase());
    return {
      symbol: doc.symbol,
      exchange: doc.exchange,
      drawings: doc.drawings ?? [],
      indicators: doc.indicators ?? [],
      chartType: doc.chartType,
      version: doc.version ?? 0,
      updatedAt: doc.updatedAt ?? null,
    };
  }

  /**
   * Replace the saved chart.
   *
   * Optimistic concurrency: the write only lands if the stored version is still
   * the one the client read. Two tabs open on the same chart would otherwise
   * overwrite each other, and the loser would never learn their drawings were
   * gone — the worst kind of data loss, because it is silent.
   */
  async save(userId: string, symbol: string, dto: SaveLayoutDto): Promise<LayoutView> {
    const key = { userId, symbol: symbol.toUpperCase() };
    const expected = dto.version ?? 0;

    const updated = await this.layoutModel.findOneAndUpdate(
      { ...key, version: expected },
      {
        $set: {
          exchange: dto.exchange.toUpperCase(),
          drawings: dto.drawings,
          indicators: dto.indicators,
          chartType: dto.chartType,
          version: expected + 1,
        },
        $setOnInsert: key,
      },
      { new: true, upsert: expected === 0 },
    ).catch((err: unknown) => {
      // An upsert races another upsert: both saw no document, one wins the
      // unique index. That is a version conflict like any other.
      if ((err as { code?: number })?.code === 11000) return null;
      throw err;
    });

    if (!updated) {
      const current = await this.get(userId, symbol);
      throw new ConflictException({
        message:
          'This chart was changed somewhere else — reload to see the newer version.',
        currentVersion: current.version,
      });
    }

    return {
      symbol: updated.symbol,
      exchange: updated.exchange,
      drawings: updated.drawings ?? [],
      indicators: updated.indicators ?? [],
      chartType: updated.chartType,
      version: updated.version,
      updatedAt: updated.updatedAt ?? null,
    };
  }

  /** Clear a chart — the "clear drawings" button, made durable. */
  async clear(userId: string, symbol: string): Promise<LayoutView> {
    await this.layoutModel.deleteOne({ userId, symbol: symbol.toUpperCase() });
    return blank(symbol.toUpperCase());
  }
}
