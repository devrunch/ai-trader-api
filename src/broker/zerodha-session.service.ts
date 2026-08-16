import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ZerodhaSession, ZerodhaSessionDocument } from './schemas/zerodha-session.schema';

export interface ZerodhaSessionView {
  accessToken: string | null;
  refreshedAt: Date | null;
}

const KEY = 'zerodha';

@Injectable()
export class ZerodhaSessionService {
  constructor(
    @InjectModel(ZerodhaSession.name)
    private readonly model: Model<ZerodhaSessionDocument>,
  ) {}

  async get(): Promise<ZerodhaSessionView> {
    const doc = await this.model.findOne({ key: KEY }).lean();
    if (!doc) return { accessToken: null, refreshedAt: null };
    return { accessToken: doc.accessToken, refreshedAt: doc.refreshedAt };
  }

  async set(accessToken: string): Promise<{ accessToken: string; refreshedAt: Date }> {
    const refreshedAt = new Date();
    await this.model.findOneAndUpdate(
      { key: KEY },
      { $set: { accessToken, refreshedAt }, $setOnInsert: { key: KEY } },
      { upsert: true },
    );
    return { accessToken, refreshedAt };
  }
}
