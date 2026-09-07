import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Alert, AlertDocument } from './schemas/alert.schema';
import { StoreAlertDto } from './dto/store-alert.dto';
import { SignalsGateway } from '../signals/signals.gateway';

@Injectable()
export class AlertsService {
  constructor(
    @InjectModel(Alert.name) private readonly alertModel: Model<AlertDocument>,
    private readonly gateway: SignalsGateway,
  ) {}

  /** Store, then push live to every connected client -- same "store, then
   *  broadcast" order SignalsService uses for a new trading signal, so a
   *  client that reconnects a moment later still sees it via GET /alerts
   *  rather than only the ones that were live for the socket push. */
  async store(payload: StoreAlertDto) {
    const saved = await this.alertModel.create({
      type: payload.type,
      title: payload.title,
      body: payload.body ?? '',
      symbols: payload.symbols ?? [],
      data: payload.data ?? {},
    });
    this.gateway.broadcastAlert(saved.toObject());
    return saved;
  }

  async recent(limit = 30) {
    return this.alertModel.find().sort({ createdAt: -1 }).limit(limit).lean();
  }
}
