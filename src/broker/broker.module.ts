import { Module } from '@nestjs/common';

/**
 * Intentional placeholder — live broker integration (Dhan / Zerodha / AngelOne)
 * is planned, and the DHAN_*, ZERODHA_* and ANGELONE_* keys in `.env` exist for
 * it. It is empty because the work has not started, not because it is broken.
 */
@Module({})
export class BrokerModule {}
