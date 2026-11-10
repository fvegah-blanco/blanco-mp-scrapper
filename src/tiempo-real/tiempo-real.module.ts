import { Module } from '@nestjs/common';
import { DocumentosModule } from '../documentos/documentos.module';
import { FichasOcService } from './fichas-oc.service';
import { OcTiempoRealService } from './oc-tiempo-real.service';
import { TiempoRealController } from './tiempo-real.controller';
import { TiempoRealCron } from './tiempo-real.cron';

@Module({
  imports: [DocumentosModule],
  controllers: [TiempoRealController],
  // MatchCompraAgilService viene de DocumentosModule: la descarga de adjuntos también lee fichas.
  providers: [OcTiempoRealService, FichasOcService, TiempoRealCron],
})
export class TiempoRealModule {}
