import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route to one or more roles, e.g. `@Roles('admin')`.
 *
 * Metadata only — `RolesGuard` is what actually enforces it. Always pair with
 * `@UseGuards(JwtAuthGuard, RolesGuard)` and in that order: RolesGuard reads
 * `req.user.role`, which JwtAuthGuard is what attaches.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
