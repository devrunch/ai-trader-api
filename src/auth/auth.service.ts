import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.userModel.findOne({ email: dto.email });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.userModel.create({ email: dto.email, passwordHash });
    return this.signToken(user);
  }

  async login(dto: LoginDto) {
    const user = await this.userModel.findOne({ email: dto.email });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.signToken(user);
  }

  async findOrCreateGoogleUser(profile: { id: string; email: string }) {
    let user = await this.userModel.findOne({ googleId: profile.id });
    if (!user) {
      user = await this.userModel.findOne({ email: profile.email });
      if (user) {
        user.googleId = profile.id;
        await user.save();
      } else {
        user = await this.userModel.create({
          email: profile.email,
          googleId: profile.id,
        });
      }
    }
    return this.signToken(user);
  }

  private signToken(user: UserDocument) {
    const payload = { sub: user._id.toString(), email: user.email };
    const token = this.jwt.sign(payload);
    return { token, user: { id: user._id, email: user.email, plan: user.plan } };
  }
}
