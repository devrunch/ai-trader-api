import { ConfigService } from '@nestjs/config';

/**
 * Returns the JWT signing secret, or throws.
 *
 * Never fall back to a hardcoded default: a missing JWT_SECRET would then boot
 * a fully functional app signing tokens with a publicly-known key, which any
 * attacker can forge. Refusing to start is the safe failure.
 */
export function requireJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET is missing or shorter than 32 characters. Set a strong random value before starting the API.',
    );
  }
  return secret;
}
