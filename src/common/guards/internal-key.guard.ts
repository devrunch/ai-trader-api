import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison.
 *
 * `crypto.timingSafeEqual` throws on unequal-length buffers, so the length is
 * checked first and short-circuits. That leaks the key length, which is not a
 * secret; what must not leak is *how much of the key* matched, and that is
 * exactly what a plain `!==` comparison leaks.
 */
function timingSafeEqualStr(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Shared-secret guard for the `internal/*` controllers.
 *
 * Network isolation alone is NOT sufficient — the serverless deployment routes
 * /api/{proxy+} publicly, which would expose every internal controller. This
 * guard replaces three hand-rolled copies of the same check (one of which was
 * missing entirely) so a new internal controller cannot be added without it.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.config.get<string>('INTERNAL_API_KEY');
    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined> }>();

    const raw = req.headers['x-internal-key'];
    const given = Array.isArray(raw) ? raw[0] : raw;

    if (!expected || !given || !timingSafeEqualStr(expected, given)) {
      throw new UnauthorizedException('Invalid internal key');
    }
    return true;
  }
}
