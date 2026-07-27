import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

/**
 * Enforces `@Roles(...)`. A route with no `@Roles` decorator is left open —
 * this guard only ever narrows access, never grants it — so it is safe to
 * apply globally later without silently locking out every existing route.
 *
 * Must run after `JwtAuthGuard` in `@UseGuards(JwtAuthGuard, RolesGuard)`:
 * this guard only reads `req.user.role`, it does not authenticate anyone.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.role || !required.includes(user.role)) {
      throw new ForbiddenException('You do not have access to this.');
    }
    return true;
  }
}
