import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

/*
 * This guard only ever narrows access. A route with no @Roles decorator must
 * stay reachable by every authenticated user — that is what lets it be applied
 * without auditing every existing controller first.
 */

function context(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardWith(required: string[] | undefined) {
  const reflector = { getAllAndOverride: jest.fn(() => required) } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('lets any authenticated request through a route with no @Roles', () => {
    const guard = guardWith(undefined);
    expect(guard.canActivate(context({ role: 'user' }))).toBe(true);
  });

  it('lets a matching role through', () => {
    const guard = guardWith(['admin']);
    expect(guard.canActivate(context({ role: 'admin' }))).toBe(true);
  });

  it('refuses a role that is not on the list', () => {
    const guard = guardWith(['admin']);
    expect(() => guard.canActivate(context({ role: 'user' }))).toThrow(ForbiddenException);
  });

  it('refuses a request with no user at all', () => {
    // JwtAuthGuard must run first, but a wiring mistake that skips it must not
    // read as "role: undefined passes".
    const guard = guardWith(['admin']);
    expect(() => guard.canActivate(context(undefined))).toThrow(ForbiddenException);
  });

  it('accepts any of several allowed roles', () => {
    const guard = guardWith(['admin', 'support']);
    expect(guard.canActivate(context({ role: 'support' }))).toBe(true);
  });
});
