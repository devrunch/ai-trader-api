import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

/** What `JwtStrategy.validate` / `GoogleStrategy.validate` attach to the request. */
interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; plan: string; role: string };
}
interface GoogleCallbackRequest extends Request {
  user: { token: string };
}

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 15 * 60 * 1000, // 15 min
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.authService.register(dto);
    res.cookie('access_token', token, COOKIE_OPTS);
    return { user };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.authService.login(dto);
    res.cookie('access_token', token, COOKIE_OPTS);
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token');
    return { message: 'Logged out' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthenticatedRequest) {
    return req.user;
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {
    // Passport redirects — handler body not reached
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  googleCallback(@Req() req: GoogleCallbackRequest, @Res() res: Response) {
    const { token } = req.user;
    res.cookie('access_token', token, COOKIE_OPTS);
    res.redirect(process.env.FRONTEND_URL ?? 'http://localhost:3000');
  }
}
