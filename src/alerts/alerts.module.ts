import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { SignalsModule } from '../signals/signals.module';
import { Alert, AlertSchema } from './schemas/alert.schema';
import { AlertsService } from './alerts.service';
import { AlertsController, AlertsInternalController } from './alerts.controller';

@Module({
  imports: [
    AuthModule,
    // For SignalsGateway -- AlertsService pushes each new alert to every
    // connected client. SignalsModule does not import AlertsModule, so
    // this is not a cycle and needs no forwardRef.
    SignalsModule,
    MongooseModule.forFeature([{ name: Alert.name, schema: AlertSchema }]),
  ],
  controllers: [AlertsController, AlertsInternalController],
  providers: [AlertsService],
})
export class AlertsModule {}
