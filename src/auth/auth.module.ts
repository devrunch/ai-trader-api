import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { User, UserSchema } from './schemas/user.schema';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { GoogleStrategy } from './google.strategy';
import { requireJwtSecret } from './jwt-secret';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        // Fail loudly rather than booting with a guessable key. A silent
        // 'dev-secret' fallback means a missing env var in production yields a
        // working app whose tokens anyone can forge — a total auth bypass with
        // no visible symptom.
        secret: requireJwtSecret(config),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '15m' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy],
  exports: [JwtModule, AuthService, MongooseModule],
})
export class AuthModule {}
