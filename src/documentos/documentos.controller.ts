import { BadRequestException, Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { ExtraccionService } from '../extraccion/extraccion.service';
import { AdjuntosService } from './adjuntos.service';

@ApiTags('Documentos')
@ApiHeader({ name: 'x-admin-key', required: false })
@UseGuards(AdminKeyGuard)
@Controller('documentos')
export class DocumentosController {
  constructor(
    private readonly adjuntos: AdjuntosService,
    private readonly extraccion: ExtraccionService,
  ) {}

  /** Encola la descarga de adjuntos. Body: { codigos: ["799512-11-LE26", "1196-63-COT26"], forzar?: true } */
  @Post('encolar')
  async encolar(@Body() body: { codigos: string[]; forzar?: boolean }) {
    if (!Array.isArray(body?.codigos) || body.codigos.length === 0) throw new BadRequestException('codigos es obligatorio');
    return { success: true, encolados: await this.adjuntos.encolar(body.codigos.slice(0, 500), body.forzar) };
  }

  /** Baja ya los adjuntos de un proceso (síncrono) y devuelve cuántos archivos nuevos guardó. */
  @Post('procesos/:codigo/descargar')
  async descargar(@Param('codigo') codigo: string) {
    await this.adjuntos.encolar([codigo], true);
    return { success: true, nuevos: await this.adjuntos.descargarProceso(codigo.toUpperCase()) };
  }

  @Post(':id/extraer')
  async extraer(@Param('id') id: string) {
    return { success: true, data: await this.extraccion.procesarDocumento(id) };
  }

  /** Re-corre el extractor de contactos sobre el texto ya guardado de un proceso. */
  @Post('procesos/:codigo/reanalizar')
  async reanalizar(@Param('codigo') codigo: string) {
    return { success: true, contactos: await this.extraccion.reanalizar(codigo.toUpperCase()) };
  }
}
