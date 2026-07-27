import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { MorningBrief, MorningBriefSchema } from './schemas/brief.schema';
import { BriefService } from './brief.service';
import { BriefController, BriefInternalController } from './brief.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: MorningBrief.name, schema: MorningBriefSchema }]),
  ],
  controllers: [BriefController, BriefInternalController],
  providers: [BriefService],
  exports: [BriefService],
})
export class BriefModule {}
