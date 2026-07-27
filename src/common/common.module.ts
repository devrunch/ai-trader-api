import { Global, Module } from '@nestjs/common';
import { InternalKeyGuard } from './guards/internal-key.guard';
import { UpstreamHttpClient } from './http/upstream-http.client';

/**
 * Global so that `@UseGuards(InternalKeyGuard)` resolves in every feature
 * module without each of them having to re-declare the provider, and so the
 * upstream HTTP client is a true singleton (one place for base URL, timeout
 * and retry policy).
 */
@Global()
@Module({
  providers: [InternalKeyGuard, UpstreamHttpClient],
  exports: [InternalKeyGuard, UpstreamHttpClient],
})
export class CommonModule {}
