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
import { PaperTradingService } from './paper-trading.service';
import { CreatePortfolioDto } from './dto/create-portfolio.dto';
import { PlaceOrderDto } from './dto/place-order.dto';
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

  @Get('portfolio/:exchange')
  getPortfolio(@Req() req: AuthRequest, @Param('exchange') exchange: string): Promise<any> {
    return this.paperTrading.getPortfolio(req.user.id, exchange.toUpperCase() as Exchange);
  }

  // ------------------------------------------------------------------
  // Orders
  // ------------------------------------------------------------------

  @Post('order')
  placeOrder(@Req() req: AuthRequest, @Body() dto: PlaceOrderDto) {
    return this.paperTrading.placeOrder(req.user.id, dto);
  }

  @Put('order/:id/execute')
  executeOrder(@Param('id') id: string) {
    return this.paperTrading.executeOrder(id);
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
