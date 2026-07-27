import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { MarketModule } from '../market/market.module';
import { SignalsModule } from '../signals/signals.module';

import { PaperPortfolio, PaperPortfolioSchema } from './schemas/paper-portfolio.schema';
import { PaperPosition, PaperPositionSchema } from './schemas/paper-position.schema';
import { PaperOrder, PaperOrderSchema } from './schemas/paper-order.schema';
import { PaperTrade, PaperTradeSchema } from './schemas/paper-trade.schema';

import { OrderExecutionService } from './order-execution.service';
import { PaperTradingService } from './paper-trading.service';
import { PortfolioAccountsService } from './portfolio-accounts.service';
import { RiskLimitsService } from './risk-limits.service';
import { PortfolioController } from './portfolio.controller';
import {
  PortfolioInternalController,
  PaperSquareOffController,
} from './portfolio-internal.controller';

@Module({
  imports: [
    AuthModule,
    WatchlistModule,
    MarketModule,
    // For SignalsGateway — PaperTradingService pushes order/position updates to
    // the user's authenticated socket room. SignalsModule does not import
    // PortfolioModule, so this is not a cycle and needs no forwardRef.
    SignalsModule,
    MongooseModule.forFeature([
      { name: PaperPortfolio.name, schema: PaperPortfolioSchema },
      { name: PaperPosition.name, schema: PaperPositionSchema },
      { name: PaperOrder.name, schema: PaperOrderSchema },
      { name: PaperTrade.name, schema: PaperTradeSchema },
    ]),
  ],
  controllers: [PortfolioController, PortfolioInternalController, PaperSquareOffController],
  providers: [
    PortfolioAccountsService,
    RiskLimitsService,
    OrderExecutionService,
    PaperTradingService,
  ],
  exports: [PaperTradingService],
})
export class PortfolioModule {}
