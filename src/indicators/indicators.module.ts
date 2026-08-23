import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { IndicatorsController } from './indicators.controller';
import { IndicatorsService } from './indicators.service';
import { Indicator, IndicatorSchema } from './schemas/indicator.schema';

/** The indicator library: 49 seeded defaults plus whatever users author
 *  themselves through the Pine editor. */
@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: Indicator.name, schema: IndicatorSchema }]),
  ],
  providers: [IndicatorsService],
  controllers: [IndicatorsController],
})
export class IndicatorsModule {}
