import { Module } from '@nestjs/common';
import { DatosAbiertosController } from './datos-abiertos.controller';
import { DatosAbiertosCron } from './datos-abiertos.cron';
import { DatosAbiertosService } from './datos-abiertos.service';

@Module({
  controllers: [DatosAbiertosController],
  providers: [DatosAbiertosService, DatosAbiertosCron],
  exports: [DatosAbiertosService],
})
export class DatosAbiertosModule {}
