import { BadRequestException, Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { CodigoMpPipe } from '../common/codigo-mp.pipe';
import { AnalisisIaService } from '../extraccion/analisis-ia.service';
import { ExtraccionService } from '../extraccion/extraccion.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdjuntosService } from './adjuntos.service';
import { EncolarDto } from './dto/encolar.dto';

/** Acciones puntuales sobre adjuntos: lo mismo que hacen los crons, para un proceso o documento. */
@ApiTags('Documentos')
@ApiSecurity('x-admin-key')
@UseGuards(AdminKeyGuard)
@Controller('documentos')
export class DocumentosController {
  constructor(
    private readonly adjuntos: AdjuntosService,
    private readonly extraccion: ExtraccionService,
    private readonly analisisIa: AnalisisIaService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiOperation({ summary: 'Encola la descarga de adjuntos de hasta 500 procesos' })
  @Post('encolar')
  @HttpCode(200)
  async encolar(@Body() body: EncolarDto) {
    return { success: true, data: { encolados: await this.adjuntos.encolar(body.codigos, body.forzar) } };
  }

  @ApiOperation({ summary: 'Baja ahora los adjuntos de un proceso y devuelve cuántos archivos nuevos guardó' })
  @Post('procesos/:codigo/descargar')
  @HttpCode(200)
  async descargar(@Param('codigo', CodigoMpPipe) codigo: string) {
    await this.adjuntos.encolar([codigo], true);
    return { success: true, data: { nuevos: await this.adjuntos.descargarProceso(codigo) } };
  }

  @ApiOperation({ summary: 'Vuelve a correr el extractor de contactos (regex) sobre el texto ya guardado de un proceso' })
  @Post('procesos/:codigo/extraer-contactos')
  @HttpCode(200)
  async extraerContactos(@Param('codigo', CodigoMpPipe) codigo: string) {
    return { success: true, data: { contactos: await this.extraccion.reanalizar(codigo) } };
  }

  @ApiOperation({ summary: 'Extrae el texto (o OCR) de un documento y sus contactos' })
  @Post(':id/extraer')
  @HttpCode(200)
  async extraer(@Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.extraccion.procesarDocumento(id) };
  }

  @ApiOperation({ summary: 'Manda un documento a Bedrock ahora (aunque sea de las bases) y devuelve lo que leyó' })
  @Post(':id/analizar-ia')
  @HttpCode(200)
  async analizarIa(@Param('id', ParseUUIDPipe) id: string) {
    if (!this.analisisIa.disponible) throw new BadRequestException('Faltan las credenciales BEDROCK_AWS_*');
    const doc = await this.prisma.documento.findUniqueOrThrow({ where: { id } });
    const contactos = await this.analisisIa.analizar(doc);
    const { analisisIa, analisisIaModelo } = await this.prisma.documento.findUniqueOrThrow({ where: { id }, select: { analisisIa: true, analisisIaModelo: true } });
    return { success: true, data: { contactos, modelo: analisisIaModelo, analisisIa } };
  }
}
