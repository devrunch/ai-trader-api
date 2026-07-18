import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';

import { PaperPortfolio, PaperPortfolioSchema } from './schemas/paper-portfolio.schema';
import { PaperPosition, PaperPositionSchema } from './schemas/paper-position.schema';
import { PaperOrder, PaperOrderSchema } from './schemas/paper-order.schema';
import { PaperTrade, PaperTradeSchema } from './schemas/paper-trade.schema';

import { PaperTradingService } from './paper-trading.service';
import { PortfolioController } from './portfolio.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: PaperPortfolio.name, schema: PaperPortfolioSchema },
      { name: PaperPosition.name, schema: PaperPositionSchema },
      { name: PaperOrder.name, schema: PaperOrderSchema },
      { name: PaperTrade.name, schema: PaperTradeSchema },
    ]),
  ],
  controllers: [PortfolioController],
  providers: [PaperTradingService],
  exports: [PaperTradingService],
})
export class PortfolioModule {}
