import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true })
  email: string;

  @Prop()
  passwordHash?: string;

  @Prop()
  googleId?: string;

  @Prop({ default: 'user' })
  role: string;

  @Prop({ default: 'free' })
  plan: string;

  @Prop({ default: true })
  isActive: boolean;

  /**
   * Per-user override for the chat agent's daily token cap.
   *
   * Unset means "use the platform default" — `ChatBudgetService`'s own
   * `CHAT_DAILY_TOKEN_CAP`. Set to 0 to cut a specific user off from the agent
   * without touching their account otherwise; set higher to give one user room
   * for a heavier testing session. Distinguished from "unset" with `typeof ===
   * 'number'`, since 0 is a meaningful value here, not an empty one.
   */
  @Prop()
  dailyTokenCapOverride?: number;
}

export const UserSchema = SchemaFactory.createForClass(User);
