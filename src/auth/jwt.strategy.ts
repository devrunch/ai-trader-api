import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { Model } from 'mongoose';
import { Request } from 'express';
import { User, UserDocument } from './schemas/user.schema';
import { requireJwtSecret } from './jwt-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.access_token ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: requireJwtSecret(config),
      ignoreExpiration: false,
    });
  }

  async validate(payload: { sub: string; email: string }) {
    const user = await this.userModel.findById(payload.sub).lean();
    if (!user || !user.isActive) throw new UnauthorizedException();
    return { id: payload.sub, email: payload.email, plan: user.plan, role: user.role };
  }
}
