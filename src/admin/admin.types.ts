/** One user's standing against the agent's token budget, for the admin panel. */
export interface AdminUserUsage {
  userId: string;
  email: string;
  role: string;
  plan: string;
  tokensToday: number;
  turnsToday: number;
  cap: number;
  /** Null when this user is on the platform default, not a per-user override. */
  capOverride: number | null;
  remaining: number;
  lastActiveAt: string | null;
}

export interface AdminUsageSummary {
  users: AdminUserUsage[];
  totals: {
    tokensToday: number;
    turnsToday: number;
    activeUsersToday: number;
    userCount: number;
    defaultCap: number;
  };
}

export interface AdminTurnSummary {
  turnId: string;
  symbol: string;
  message: string;
  tokens: number;
  stopReason: string | null;
  createdAt: string;
}
