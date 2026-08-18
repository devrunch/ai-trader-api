import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SYMBOL_RE } from '../common/symbol';
import { ChartLayoutsService } from './chart-layouts.service';
import { SaveLayoutDto } from './dto/save-layout.dto';

interface AuthRequest extends Request {
  user: { id: string; email: string; plan: string };
}

function validSymbol(raw: string): string {
  const symbol = (raw ?? '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) throw new BadRequestException(`Invalid symbol: ${raw}`);
  return symbol;
}

/** The user's chart state, per symbol. Scoped to the authenticated user. */
@UseGuards(JwtAuthGuard)
@Controller('chart-layouts')
export class ChartLayoutsController {
  constructor(private readonly layouts: ChartLayoutsService) {}

  @Get(':symbol')
  get(@Req() req: AuthRequest, @Param('symbol') symbol: string) {
    return this.layouts.get(req.user.id, validSymbol(symbol));
  }

  @Put(':symbol')
  save(
    @Req() req: AuthRequest,
    @Param('symbol') symbol: string,
    @Body() body: SaveLayoutDto,
  ) {
    return this.layouts.save(req.user.id, validSymbol(symbol), body);
  }

  @Delete(':symbol')
  clear(@Req() req: AuthRequest, @Param('symbol') symbol: string) {
    return this.layouts.clear(req.user.id, validSymbol(symbol));
  }
}
