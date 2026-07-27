import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminService } from './admin.service';
import { SetCapDto } from './dto/set-cap.dto';

const parseLimit = (raw: string | undefined, fallback: number): number => {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Admin visibility into the agent's token spend, and the one lever over it:
 * a per-user daily cap.
 *
 * Every route requires `role: 'admin'` — checked server-side by `RolesGuard`,
 * which is the actual protection. Nothing about who can reach this page
 * depends on the frontend hiding a nav link.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** Every user, today's spend, and their effective cap. */
  @Get('usage')
  usage() {
    return this.admin.usageToday();
  }

  /** One user's recent turns — what they asked, and what it cost. */
  @Get('usage/:userId/turns')
  turns(@Param('userId') userId: string, @Query('limit') limit?: string) {
    return this.admin.recentTurns(userId, parseLimit(limit, 20));
  }

  /** Set, raise, or clear (send `cap: null`) a user's daily token cap. */
  @Patch('users/:userId/cap')
  setCap(@Param('userId') userId: string, @Body() body: SetCapDto) {
    return this.admin.setCap(userId, body.cap ?? null);
  }
}
