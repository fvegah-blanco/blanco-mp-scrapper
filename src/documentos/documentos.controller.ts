import { BadRequestException, Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { AnalisisIaService } from '../extraccion/analisis-ia.service';
import { ExtraccionService } from '../extraccion/extraccion.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdjuntosService } from './adjuntos.service';

@ApiTags('Documentos')
@ApiHeader({ name: 'x-admin-key', required: false })
@UseGuards(AdminKeyGuard)
@Controller('documentos')
export class DocumentosController {
  constructor(
    private readonly adjuntos: AdjuntosService,
    private readonly extraccion: ExtraccionService,
    private readonly analisisIa: AnalisisIaService,
    private readonly prisma: PrismaService,
  ) {}

  /** Manda un documento a Bedrock ahora (aunque sea de las bases) y devuelve lo que leyó. */
  @Post(':id/analizar-ia')
  async analizarIa(@Param('id') id: string) {
    if (!this.analisisIa.disponible) throw new BadRequestException('Faltan las credenciales BEDROCK_AWS_*');
    const doc = await this.prisma.documento.findUniqueOrThrow({ where: { id } });
    const contactos = await this.analisisIa.analizar(doc);
    const actualizado = await this.prisma.documento.findUniqueOrThrow({ where: { id }, select: { analisisIa: true, analisisIaModelo: true } });
    return { success: true, contactos, data: actualizado };
  }

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
