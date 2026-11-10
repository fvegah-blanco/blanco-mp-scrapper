import { Module } from '@nestjs/common';
import { AnalisisIaCron, ContactosExtraccionCron, DocumentosCron } from './documentos.cron';
import { DocumentosController } from './documentos.controller';
import { AdjuntosService } from './adjuntos.service';
import { StorageService } from './storage.service';
import { AnalisisIaService } from '../extraccion/analisis-ia.service';
import { ExtraccionService } from '../extraccion/extraccion.service';
import { OcrService } from '../extraccion/ocr.service';
import { TextoService } from '../extraccion/texto.service';
import { MatchCompraAgilService } from '../tiempo-real/match-compra-agil.service';

@Module({
  controllers: [DocumentosController],
  providers: [StorageService, MatchCompraAgilService, AdjuntosService, OcrService, TextoService, ExtraccionService, AnalisisIaService, DocumentosCron, ContactosExtraccionCron, AnalisisIaCron],
  exports: [AdjuntosService, OcrService, ExtraccionService, MatchCompraAgilService],
})
export class DocumentosModule {}
