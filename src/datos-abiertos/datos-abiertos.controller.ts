import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { TipoReporte } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { getErrorMessage } from '../common/errores';
import { DatosAbiertosService } from './datos-abiertos.service';

function tipoValido(tipo: string): TipoReporte {
  const t = tipo.toUpperCase();
  if (t !== 'OC' && t !== 'LIC') throw new BadRequestException('tipo debe ser OC o LIC');
  return t as TipoReporte;
}

@ApiTags('Datos abiertos')
@ApiHeader({ name: 'x-admin-key', required: false })
@UseGuards(AdminKeyGuard)
@Controller('datos-abiertos')
export class DatosAbiertosController {
  constructor(
    @InjectPinoLogger(DatosAbiertosController.name) private readonly logger: PinoLogger,
    private readonly datosAbiertos: DatosAbiertosService,
  ) {}

  /** Plan del backfill con el estado de cada mes (FALTA, OK, ERROR...). */
  @Get('estado')
  async estado() {
    return { success: true, data: await this.datosAbiertos.estado() };
  }

  @Get('archivos')
  async archivos(@Query('anio') anio?: string) {
    return { success: true, data: await this.datosAbiertos.listar(anio ? Number(anio) : undefined) };
  }

  /** Procesa un mes puntual en segundo plano. `?forzar=true` ignora el ETag. */
  @Post('archivos/:tipo/:anio/:mes')
  procesarMes(
    @Param('tipo') tipo: string,
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
    @Query('forzar') forzar?: string,
  ) {
    const t = tipoValido(tipo);
    void this.datosAbiertos
      .procesarMes(t, anio, mes, forzar === 'true')
      .catch((e) => this.logger.error({ tipo: t, anio, mes, error: getErrorMessage(e) }, 'Falló el proceso del mes'));
    return { success: true, message: `Procesando ${t} ${anio}-${mes}; ver GET /datos-abiertos/archivos` };
  }

  /** Importa un CSV que ya está en el disco del servidor (p.ej. el que baja el navegador). */
  @Post('importar-local')
  importarLocal(@Body() body: { tipo: string; ruta: string }) {
    const t = tipoValido(body?.tipo ?? '');
    if (!body?.ruta || !/\.csv$/i.test(body.ruta)) throw new BadRequestException('ruta debe apuntar a un .csv');
    void this.datosAbiertos
      .importarCsvLocal(t, body.ruta)
      .then((r) => this.logger.info({ tipo: t, ruta: body.ruta, ...r }, 'CSV local importado'))
      .catch((e) => this.logger.error({ ruta: body.ruta, error: getErrorMessage(e) }, 'Falló la importación local'));
    return { success: true, message: 'Importando en segundo plano' };
  }
}
