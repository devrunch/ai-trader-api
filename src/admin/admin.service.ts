import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { dayStart } from '../common/market-session';
import { ChatBudgetService } from '../chat/chat-budget.service';
import { ChatTurn, ChatTurnDocument } from '../chat/schemas/chat-turn.schema';
import { AdminTurnSummary, AdminUsageSummary, AdminUserUsage } from './admin.types';

/**
 * What an admin needs to see and change about the agent's token spend.
 *
 * Reads the same `chat_turns` collection `ChatBudgetService` already sums per
 * request — this is that same number, listed across every user instead of
 * checked for one. No parallel accounting to keep in sync.
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(ChatTurn.name)
    private readonly turnModel: Model<ChatTurnDocument>,
    private readonly budget: ChatBudgetService,
  ) {}

  /** Every user, with today's spend and their effective cap. */
  async usageToday(): Promise<AdminUsageSummary> {
    const [users, usageRows] = await Promise.all([
      this.userModel
        .find()
        .select('email role plan dailyTokenCapOverride')
        .lean(),
      this.turnModel.aggregate<{
        _id: string;
        tokens: number;
        turns: number;
        lastActiveAt: Date;
      }>([
        { $match: { createdAt: { $gte: dayStart() } } },
        {
          $group: {
            _id: '$userId',
            tokens: { $sum: { $ifNull: ['$usage.total_tokens', 0] } },
            turns: { $sum: 1 },
            lastActiveAt: { $max: '$createdAt' },
          },
        },
      ]),
    ]);

    const usageByUser = new Map(usageRows.map((r) => [r._id, r]));
    const defaultCap = this.budget.defaultCap;

    const rows: AdminUserUsage[] = users.map((u) => {
      const usage = usageByUser.get(String(u._id));
      const override = u.dailyTokenCapOverride;
      const cap = typeof override === 'number' ? override : defaultCap;
      const tokens = usage?.tokens ?? 0;
      return {
        userId: String(u._id),
        email: u.email,
        role: u.role,
        plan: u.plan,
        tokensToday: tokens,
        turnsToday: usage?.turns ?? 0,
        cap,
        capOverride: typeof override === 'number' ? override : null,
        remaining: Math.max(0, cap - tokens),
        lastActiveAt: usage?.lastActiveAt ? usage.lastActiveAt.toISOString() : null,
      };
    });

    // Highest spenders first — the reason to open this page is usually "who
    // is burning tokens", not an alphabetised user list.
    rows.sort((a, b) => b.tokensToday - a.tokensToday);

    return {
      users: rows,
      totals: {
        tokensToday: rows.reduce((s, r) => s + r.tokensToday, 0),
        turnsToday: rows.reduce((s, r) => s + r.turnsToday, 0),
        activeUsersToday: rows.filter((r) => r.turnsToday > 0).length,
        userCount: rows.length,
        defaultCap,
      },
    };
  }

  /** One user's recent turns — what they actually asked, and what it cost. */
  async recentTurns(userId: string, limit = 20): Promise<AdminTurnSummary[]> {
    const turns = await this.turnModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .select('turnId symbol message usage stopReason createdAt')
      .lean();

    return turns.map((t) => ({
      turnId: t.turnId,
      symbol: t.symbol,
      message: t.message,
      tokens: Number((t.usage as Record<string, unknown> | undefined)?.total_tokens ?? 0),
      stopReason: t.stopReason ?? null,
      createdAt: (t.createdAt as Date).toISOString(),
    }));
  }

  /**
   * Set, raise, or clear a user's daily token cap.
   *
   * `cap: null` clears the override and returns the user to the platform
   * default. `cap: 0` is a real, distinct value — it cuts the user off from
   * the agent entirely without touching their account otherwise, which is the
   * control an admin reaches for when one user is running away with usage and
   * the account itself is not the problem.
   */
  async setCap(userId: string, cap: number | null): Promise<AdminUserUsage> {
    const update = cap === null
      ? { $unset: { dailyTokenCapOverride: 1 } }
      : { $set: { dailyTokenCapOverride: cap } };

    let user: (Pick<UserDocument, 'email' | 'role' | 'plan' | 'dailyTokenCapOverride'>) | null;
    try {
      user = await this.userModel
        .findByIdAndUpdate(userId, update, { new: true })
        .select('email role plan dailyTokenCapOverride')
        .lean();
    } catch (err) {
      // A malformed id (not 24 hex chars) makes Mongoose throw a CastError
      // before the query even runs, rather than returning null like a
      // well-formed-but-absent id does. Both mean the same thing to an admin
      // clicking a stale link: "no such user" — not a 500.
      if ((err as { name?: string }).name === 'CastError') {
        throw new NotFoundException('User not found');
      }
      throw err;
    }
    if (!user) throw new NotFoundException('User not found');

    const effectiveCap = typeof user.dailyTokenCapOverride === 'number'
      ? user.dailyTokenCapOverride
      : this.budget.defaultCap;

    // Reuses the same spend query the usage list already runs, rather than
    // returning a half-populated row the UI would have to special-case.
    const [row] = await this.turnModel.aggregate<{
      tokens: number; turns: number; lastActiveAt: Date;
    }>([
      { $match: { userId, createdAt: { $gte: dayStart() } } },
      {
        $group: {
          _id: null,
          tokens: { $sum: { $ifNull: ['$usage.total_tokens', 0] } },
          turns: { $sum: 1 },
          lastActiveAt: { $max: '$createdAt' },
        },
      },
    ]);
    const tokens = row?.tokens ?? 0;

    return {
      userId,
      email: user.email,
      role: user.role,
      plan: user.plan,
      tokensToday: tokens,
      turnsToday: row?.turns ?? 0,
      cap: effectiveCap,
      capOverride: typeof user.dailyTokenCapOverride === 'number' ? user.dailyTokenCapOverride : null,
      remaining: Math.max(0, effectiveCap - tokens),
      lastActiveAt: row?.lastActiveAt ? row.lastActiveAt.toISOString() : null,
    };
  }
}
