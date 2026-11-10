import { Module } from '@nestjs/common';
import { ContactosExtraccionCron, DocumentosCron } from './documentos.cron';
import { DocumentosController } from './documentos.controller';
import { AdjuntosService } from './adjuntos.service';
import { StorageService } from './storage.service';
import { ExtraccionService } from '../extraccion/extraccion.service';
import { OcrService } from '../extraccion/ocr.service';
import { TextoService } from '../extraccion/texto.service';

@Module({
  controllers: [DocumentosController],
  providers: [StorageService, AdjuntosService, OcrService, TextoService, ExtraccionService, DocumentosCron, ContactosExtraccionCron],
  exports: [AdjuntosService, OcrService, ExtraccionService],
})
export class DocumentosModule {}
