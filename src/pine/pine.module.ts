import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PineController } from './pine.controller';
import { PineService } from './pine.service';

@Module({
  imports: [AuthModule],
  controllers: [PineController],
  providers: [PineService],
})
export class PineModule {}
