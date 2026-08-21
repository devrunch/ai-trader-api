import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PineService } from './pine.service';
import { RunPineDto } from './dto/run-pine.dto';

@UseGuards(JwtAuthGuard)
@Controller('pine')
export class PineController {
  constructor(private readonly pine: PineService) {}

  @Post('run')
  run(@Body() dto: RunPineDto) {
    return this.pine.run(dto);
  }
}
