import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { BrokerModule } from './broker/broker.module';
import { SignalsModule } from './signals/signals.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MarketModule } from './market/market.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { BriefModule } from './brief/brief.module';
import { ChatModule } from './chat/chat.module';
import { ChartLayoutsModule } from './chart-layouts/chart-layouts.module';
import { AdminModule } from './admin/admin.module';
import { PineModule } from './pine/pine.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { envValidationSchema } from './config/env.validation';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    // Global default. Registration is open, so any authenticated user could
    // previously loop the expensive endpoints without limit.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    CommonModule,
    AuthModule,
    BrokerModule,
    SignalsModule,
    PortfolioModule,
    NotificationsModule,
    MarketModule,
    WatchlistModule,
    BriefModule,
    ChatModule,
    ChartLayoutsModule,
    AdminModule,
    PineModule,
    IndicatorsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
