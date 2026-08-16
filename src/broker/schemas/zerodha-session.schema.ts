import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ZerodhaSessionDocument = ZerodhaSession & Document;

/**
 * The current Kite Connect access_token — one shared broker account, not a
 * per-user credential, so this is a singleton document (`key: 'zerodha'` is
 * fixed) rather than keyed by user.
 *
 * Refreshed daily by a scripted login in the Python signals service (Kite
 * tokens expire ~6am IST); this collection is just where the result lands so
 * every process reading market data sees the same current token without
 * each one having to log in itself.
 */
@Schema({ timestamps: false })
export class ZerodhaSession {
  @Prop({ required: true, default: 'zerodha', unique: true })
  key: string;

  @Prop({ required: true })
  accessToken: string;

  @Prop({ required: true })
  refreshedAt: Date;
}

export const ZerodhaSessionSchema = SchemaFactory.createForClass(ZerodhaSession);
