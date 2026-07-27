import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { dayStart } from '../common/market-session';
import { ChatTurn, ChatTurnDocument } from './schemas/chat-turn.schema';

/**
 * How much one user may spend on the agent in a day.
 *
 * The rate limiter bounds requests per minute, which is not the same thing:
 * ten turns a minute, sustained, is a real bill nobody authorised. A turn can
 * legitimately cost tens of thousands of tokens — six model rounds, each
 * carrying the full transcript — so the ceiling has to be measured in tokens,
 * not in calls.
 *
 * Deliberately checked in NestJS rather than in the signals service: this is
 * about a USER, and the JWT is here. The signals service has budgets of its
 * own, but they bound one turn, not one person's day.
 */

/** Roughly 15–25 normal turns. Generous for real use, ruinous for a loop. */
export const DEFAULT_DAILY_TOKEN_CAP = 400_000;

export interface SpendToday {
  tokens: number;
  turns: number;
  cap: number;
  remaining: number;
}

@Injectable()
export class ChatBudgetService {
  private readonly logger = new Logger(ChatBudgetService.name);
  /** The platform default. A per-user override, if one is set, wins over this. */
  readonly defaultCap: number;

  constructor(
    @InjectModel(ChatTurn.name)
    private readonly turnModel: Model<ChatTurnDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    config: ConfigService,
  ) {
    const configured = Number(config.get<string>('CHAT_DAILY_TOKEN_CAP'));
    this.defaultCap = Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_DAILY_TOKEN_CAP;
  }

  /**
   * This user's cap for today: their own override if an admin set one,
   * otherwise the platform default.
   *
   * A lookup failure falls back to the default rather than propagating — the
   * caller (`spentToday`, and through it `assertWithinBudget`) already has its
   * own fail-open policy for exactly this kind of outage, and duplicating that
   * decision in two places is how they eventually disagree.
   */
  private async capFor(userId: string): Promise<number> {
    try {
      const user = await this.userModel.findById(userId).select('dailyTokenCapOverride').lean();
      const override = user?.dailyTokenCapOverride;
      return typeof override === 'number' ? override : this.defaultCap;
    } catch (err) {
      this.logger.warn(`Could not read the cap override for ${userId}: ${(err as Error)?.message}`);
      return this.defaultCap;
    }
  }

  /** What this user has spent since midnight IST. */
  async spentToday(userId: string): Promise<SpendToday> {
    const [[row], cap] = await Promise.all([
      this.turnModel.aggregate<{ tokens: number; turns: number }>([
        { $match: { userId, createdAt: { $gte: dayStart() } } },
        {
          $group: {
            _id: null,
            // A turn recorded before usage was tracked, or from a provider that
            // reports none, contributes 0 rather than breaking the sum.
            tokens: { $sum: { $ifNull: ['$usage.total_tokens', 0] } },
            turns: { $sum: 1 },
          },
        },
      ]),
      this.capFor(userId),
    ]);

    const tokens = row?.tokens ?? 0;
    return {
      tokens,
      turns: row?.turns ?? 0,
      cap,
      remaining: Math.max(0, cap - tokens),
    };
  }

  /**
   * Refuse a turn that would push the user past their day's budget.
   *
   * Checked before the turn, not after: the cost is incurred upstream the
   * moment the request is made, so a check afterwards would only tell the user
   * what they had already spent.
   *
   * A failure to READ the budget must not block the user. The alternative — a
   * Mongo hiccup locking everyone out of the product's main feature — is worse
   * than one uncounted turn.
   */
  async assertWithinBudget(userId: string): Promise<void> {
    let spend: SpendToday;
    try {
      spend = await this.spentToday(userId);
    } catch (err) {
      this.logger.error(
        `Could not read the chat budget for ${userId}, allowing the turn: ${(err as Error)?.message}`,
      );
      return;
    }

    if (spend.remaining > 0) return;

    this.logger.warn(
      `Chat budget exhausted for ${userId}: ${spend.tokens} tokens over ${spend.turns} turns`,
    );
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        // Written for the person reading it, not for a log. It says what
        // happened, that nothing is broken, and when they can continue.
        message:
          "You've reached today's limit for AI analysis. It resets at midnight — " +
          'your charts, strategies and positions are unaffected.',
        error: 'Daily analysis limit reached',
        turnsToday: spend.turns,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
