import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { DEFAULT_INDICATORS } from './default-indicators.seed';
import { IndicatorDto } from './dto/indicator.dto';
import { Indicator, IndicatorDocument } from './schemas/indicator.schema';

export interface IndicatorView {
  id: string;
  ownerId: string | null;
  name: string;
  category: string;
  pane: 'main' | 'sub' | 'volume';
  source: string;
}

function toView(doc: Pick<Indicator, 'id' | 'ownerId' | 'name' | 'category' | 'pane' | 'source'>): IndicatorView {
  return { id: doc.id, ownerId: doc.ownerId, name: doc.name, category: doc.category, pane: doc.pane, source: doc.source };
}

/** `name`, lowercased and stripped to [a-z0-9-], plus a short random suffix
 *  so two users picking the same name (or the same name as a default) never
 *  collide on the unique `id` index. */
function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'indicator';
  return `custom-${base}-${randomUUID().slice(0, 8)}`;
}

@Injectable()
export class IndicatorsService implements OnModuleInit {
  private readonly logger = new Logger(IndicatorsService.name);

  constructor(
    @InjectModel(Indicator.name)
    private readonly indicatorModel: Model<IndicatorDocument>,
  ) {}

  /**
   * Idempotent on every boot: upserts all 49 defaults by `id`, never touches
   * a user's own indicators (ownerId always null here). Self-healing if a
   * default doc is ever deleted by hand, and picks up a code change to a
   * default's source on the next deploy without a separate migration step.
   */
  async onModuleInit(): Promise<void> {
    for (const def of DEFAULT_INDICATORS) {
      await this.indicatorModel.updateOne(
        { id: def.id },
        { $set: { ...def, ownerId: null } },
        { upsert: true },
      );
    }
    this.logger.log(`Seeded ${DEFAULT_INDICATORS.length} default indicators`);
  }

  /** Every default, plus this user's own -- merged, since the picker shows
   *  them as one list. Ownership becomes relevant again only on write. */
  async listAll(userId: string): Promise<IndicatorView[]> {
    const docs = await this.indicatorModel
      .find({ $or: [{ ownerId: null }, { ownerId: userId }] })
      .sort({ category: 1, name: 1 })
      .lean();
    return docs.map((d) => toView(d));
  }

  async create(userId: string, dto: IndicatorDto): Promise<IndicatorView> {
    const id = slugify(dto.name);
    const doc = await this.indicatorModel.create({ id, ownerId: userId, ...dto });
    return toView(doc);
  }

  /**
   * Replace wholesale, same "PUT replaces the whole thing" philosophy as
   * chart-layouts' save() -- a partial PATCH would need its own merge
   * semantics for no real benefit here.
   *
   * Scoped to `{ id, ownerId: userId }` in the query itself, not a
   * fetch-then-compare -- a default (ownerId: null) or another user's
   * indicator simply never matches, so there is no separate ownership
   * check to forget.
   */
  async update(userId: string, id: string, dto: IndicatorDto): Promise<IndicatorView> {
    const updated = await this.indicatorModel.findOneAndUpdate(
      { id, ownerId: userId },
      { $set: dto },
      { new: true },
    );
    if (!updated) throw await this.notFoundOrForbidden(id);
    return toView(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.indicatorModel.deleteOne({ id, ownerId: userId });
    if (result.deletedCount === 0) throw await this.notFoundOrForbidden(id);
  }

  /** Distinguishes "doesn't exist" from "exists but isn't yours" (a default,
   *  or another user's custom indicator) -- a 403 tells the client something
   *  different happened than a 404 would, worth the extra lookup. */
  private async notFoundOrForbidden(id: string): Promise<NotFoundException | ForbiddenException> {
    const exists = await this.indicatorModel.exists({ id });
    return exists
      ? new ForbiddenException('You can only edit or delete your own indicators')
      : new NotFoundException(`No indicator with id ${id}`);
  }
}
