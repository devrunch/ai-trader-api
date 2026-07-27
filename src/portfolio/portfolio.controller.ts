import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaperTradingService, PortfolioView, RiskState } from './paper-trading.service';
import { CreatePortfolioDto } from './dto/create-portfolio.dto';
import { PlaceOrderDto } from './dto/place-order.dto';
import { ResetPortfolioDto } from './dto/reset-portfolio.dto';
import { Exchange } from './schemas/paper-portfolio.schema';

interface AuthRequest extends Request {
  user: { id: string; email: string; plan: string };
}

@UseGuards(JwtAuthGuard)
@Controller('paper')
export class PortfolioController {
  constructor(private readonly paperTrading: PaperTradingService) {}

  // ------------------------------------------------------------------
  // Portfolio
  // ------------------------------------------------------------------

  @Post('portfolio')
  createPortfolio(@Req() req: AuthRequest, @Body() dto: CreatePortfolioDto) {
    return this.paperTrading.createPortfolio(req.user.id, dto);
  }

  @Get('portfolio')
  listPortfolios(@Req() req: AuthRequest) {
    return this.paperTrading.listPortfolios(req.user.id);
  }

  @Post('reset')
  reset(@Req() req: AuthRequest, @Body() dto: ResetPortfolioDto) {
    const exch = (dto?.exchange?.toUpperCase() as Exchange) || Exchange.NSE;
    return this.paperTrading.resetPortfolio(req.user.id, exch);
  }

  @Get('portfolio/:exchange')
  getPortfolio(@Req() req: AuthRequest, @Param('exchange') exchange: string): Promise<PortfolioView> {
    return this.paperTrading.getPortfolio(req.user.id, exchange.toUpperCase() as Exchange);
  }

  /**
   * Where the account stands against the position, aggregate-risk and daily-loss
   * limits. Exposed so the UI can show the ceiling *before* an order is refused,
   * rather than only in the rejection message.
   */
  @Get('risk')
  getRiskState(@Req() req: AuthRequest, @Query('exchange') exchange?: string): Promise<RiskState> {
    return this.paperTrading.getRiskState(
      req.user.id,
      ((exchange ?? 'NSE').toUpperCase()) as Exchange,
    );
  }

  // ------------------------------------------------------------------
  // Orders
  // ------------------------------------------------------------------

  @Post('order')
  placeOrder(@Req() req: AuthRequest, @Body() dto: PlaceOrderDto) {
    return this.paperTrading.placeOrder(req.user.id, dto);
  }

  // Scoped to the authenticated user — without this any logged-in user could
  // execute another user's pending order by guessing/knowing its id.
  @Put('order/:id/execute')
  executeOrder(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.paperTrading.executeOrder(id, undefined, req.user.id);
  }

  @Get('orders')
  getOrders(@Req() req: AuthRequest, @Query('limit') limit?: string) {
    return this.paperTrading.getOrders(req.user.id, limit ? parseInt(limit) : 50);
  }

  // ------------------------------------------------------------------
  // Positions + Trades
  // ------------------------------------------------------------------

  @Get('positions')
  getPositions(@Req() req: AuthRequest) {
    return this.paperTrading.getPositions(req.user.id);
  }

  @Put('positions/refresh')
  refreshPrices(@Req() req: AuthRequest) {
    return this.paperTrading.refreshPositionPrices(req.user.id);
  }

  @Get('trades')
  getTrades(@Req() req: AuthRequest, @Query('limit') limit?: string) {
    return this.paperTrading.getTrades(req.user.id, limit ? parseInt(limit) : 100);
  }
}
