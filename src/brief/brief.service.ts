import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MorningBrief, MorningBriefDocument } from './schemas/brief.schema';
import { StoreBriefDto } from './dto/store-brief.dto';

@Injectable()
export class BriefService {
  constructor(
    @InjectModel(MorningBrief.name)
    private readonly briefModel: Model<MorningBriefDocument>,
  ) {}

  /** Upsert by date — regenerating a day's brief replaces it rather than duplicating. */
  async store(payload: StoreBriefDto) {
    const date = payload?.date;
    if (!date) throw new BadRequestException('Brief payload missing date');
    const saved = await this.briefModel.findOneAndUpdate(
      { date },
      {
        date,
        generatedAt: payload.generated_at ?? new Date().toISOString(),
        marketRead: payload.market_read ?? {},
        globalCues: payload.global_cues ?? [],
        narrative: payload.narrative ?? '',
        candidates: payload.candidates ?? [],
        disclaimer: payload.disclaimer ?? '',
      },
      { upsert: true, new: true },
    );
    // `new: true` + `upsert: true` always returns a document; the non-null
    // assertion documents that rather than forcing every caller to null-check.
    return saved!;
  }

  /** A missing single resource is a 404, not a 200 carrying `null`. */
  async latest() {
    const doc = await this.briefModel.findOne().sort({ date: -1 }).lean();
    if (!doc) throw new NotFoundException('No morning brief has been generated yet');
    return doc;
  }

  async byDate(date: string) {
    const doc = await this.briefModel.findOne({ date }).lean();
    if (!doc) throw new NotFoundException(`No morning brief for ${date}`);
    return doc;
  }

  async recent(limit = 7) {
    return this.briefModel
      .find()
      .sort({ date: -1 })
      .limit(limit)
      .select('date generatedAt marketRead narrative')
      .lean();
  }
}
