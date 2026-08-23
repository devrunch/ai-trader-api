import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IndicatorDto } from './dto/indicator.dto';
import { IndicatorsService } from './indicators.service';

interface AuthRequest extends Request {
  user: { id: string; email: string; plan: string };
}

/** Indicators: the 49 built-ins (shared, read-only to every user) plus
 *  whatever a user has authored themselves (private, fully theirs). */
@UseGuards(JwtAuthGuard)
@Controller('indicators')
export class IndicatorsController {
  constructor(private readonly indicators: IndicatorsService) {}

  @Get()
  list(@Req() req: AuthRequest) {
    return this.indicators.listAll(req.user.id);
  }

  @Post()
  create(@Req() req: AuthRequest, @Body() dto: IndicatorDto) {
    return this.indicators.create(req.user.id, dto);
  }

  @Put(':id')
  update(@Req() req: AuthRequest, @Param('id') id: string, @Body() dto: IndicatorDto) {
    return this.indicators.update(req.user.id, id, dto);
  }

  @Delete(':id')
  async remove(@Req() req: AuthRequest, @Param('id') id: string) {
    await this.indicators.remove(req.user.id, id);
    return { removed: true };
  }
}
