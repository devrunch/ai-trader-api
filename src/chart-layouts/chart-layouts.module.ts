import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { ChartLayoutsController } from './chart-layouts.controller';
import { ChartLayoutsService } from './chart-layouts.service';
import { ChartLayout, ChartLayoutSchema } from './schemas/chart-layout.schema';

/** Durable chart state: the user's drawings, the agent's marks, and indicators. */
@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: ChartLayout.name, schema: ChartLayoutSchema }]),
  ],
  providers: [ChartLayoutsService],
  controllers: [ChartLayoutsController],
})
export class ChartLayoutsModule {}
