import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseBoolPipe, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { isAbsolute, relative, resolve } from 'path';
import { TipoReporte } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { getErrorMessage } from '../common/errores';
import { DatosAbiertosService } from './datos-abiertos.service';
import { ImportarLocalDto } from './dto/importar-local.dto';

function tipoValido(tipo: string): TipoReporte {
  const t = tipo.toUpperCase();
  if (t !== 'OC' && t !== 'LIC') throw new BadRequestException('tipo debe ser OC o LIC');
  return t as TipoReporte;
}

@ApiTags('Datos abiertos')
@ApiSecurity('x-admin-key')
@UseGuards(AdminKeyGuard)
@Controller('datos-abiertos')
export class DatosAbiertosController {
  constructor(
    @InjectPinoLogger(DatosAbiertosController.name) private readonly logger: PinoLogger,
    private readonly datosAbiertos: DatosAbiertosService,
  ) {}

  @ApiOperation({ summary: 'Plan del backfill con el estado de cada mes (FALTA, OK, ERROR...)' })
  @Get('estado')
  async estado() {
    return { success: true, data: await this.datosAbiertos.estado() };
  }

  @ApiOperation({ summary: 'Archivos mensuales ya procesados, con ETag, filas y errores' })
  @ApiQuery({ name: 'anio', required: false, type: Number })
  @Get('archivos')
  async archivos(@Query('anio', new ParseIntPipe({ optional: true })) anio?: number) {
    return { success: true, data: await this.datosAbiertos.listar(anio) };
  }

  @ApiOperation({ summary: 'Procesa un mes puntual en segundo plano; forzar=true ignora el ETag' })
  @ApiQuery({ name: 'forzar', required: false, type: Boolean })
  @Post('archivos/:tipo/:anio/:mes')
  @HttpCode(202)
  procesarMes(
    @Param('tipo') tipo: string,
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
    @Query('forzar', new ParseBoolPipe({ optional: true })) forzar?: boolean,
  ) {
    const t = tipoValido(tipo);
    if (anio < 2007 || anio > new Date().getFullYear() || mes < 1 || mes > 12) throw new BadRequestException('anio o mes fuera de rango');
    void this.datosAbiertos
      .procesarMes(t, anio, mes, forzar ?? false)
      .catch((e) => this.logger.error({ tipo: t, anio, mes, error: getErrorMessage(e) }, 'Falló el proceso del mes'));
    return { success: true, message: `Procesando ${t} ${anio}-${mes}; ver GET /datos-abiertos/archivos` };
  }

  @ApiOperation({ summary: 'Importa en segundo plano un CSV que ya está en TMP_DIR del servidor' })
  @Post('importar-local')
  @HttpCode(202)
  importarLocal(@Body() body: ImportarLocalDto) {
    // Solo archivos dentro de TMP_DIR: la API no lee rutas arbitrarias del servidor.
    const base = resolve(process.env.TMP_DIR ?? './tmp');
    const ruta = resolve(base, body.ruta);
    const rel = relative(base, ruta);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new BadRequestException('ruta debe quedar dentro de TMP_DIR');
    void this.datosAbiertos
      .importarCsvLocal(body.tipo, ruta)
      .then((r) => this.logger.info({ tipo: body.tipo, ruta, ...r }, 'CSV local importado'))
      .catch((e) => this.logger.error({ ruta, error: getErrorMessage(e) }, 'Falló la importación local'));
    return { success: true, message: 'Importando en segundo plano' };
  }
}
