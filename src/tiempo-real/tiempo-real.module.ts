import { Module } from '@nestjs/common';
import { DocumentosModule } from '../documentos/documentos.module';
import { FichasOcService } from './fichas-oc.service';
import { MatchCompraAgilService } from './match-compra-agil.service';
import { OcTiempoRealService } from './oc-tiempo-real.service';
import { TiempoRealController } from './tiempo-real.controller';
import { TiempoRealCron } from './tiempo-real.cron';

@Module({
  imports: [DocumentosModule],
  controllers: [TiempoRealController],
  providers: [OcTiempoRealService, FichasOcService, MatchCompraAgilService, TiempoRealCron],
})
export class TiempoRealModule {}
