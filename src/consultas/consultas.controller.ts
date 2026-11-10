import { Controller, DefaultValuePipe, Get, NotFoundException, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Prisma, type RolContacto } from '@prisma/client';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { normalizarRut } from '../common/rut';
import { PrismaService } from '../prisma/prisma.service';

/** Lectura de lo ingerido: resumen, adjudicaciones, fichas de empresa y proceso, contactos. */
@ApiTags('Consultas')
@ApiHeader({ name: 'x-admin-key', required: false })
@UseGuards(AdminKeyGuard)
@Controller('consultas')
export class ConsultasController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('resumen')
  async resumen() {
    const [organismos, proveedores, procesos, ordenes, ocAgSinProceso, adjudicaciones, documentos, contactos, ultimaOc] = await Promise.all([
      this.prisma.empresa.count({ where: { esOrganismo: true } }),
      this.prisma.empresa.count({ where: { esProveedor: true } }),
      this.prisma.proceso.groupBy({ by: ['tipo'], _count: true }),
      this.prisma.ordenCompra.groupBy({ by: ['fuente'], _count: true }),
      this.prisma.ordenCompra.count({ where: { tipo: 'AG', procesoCodigo: null } }),
      this.prisma.adjudicacion.groupBy({ by: ['origen'], _count: true }),
      this.prisma.documento.groupBy({ by: ['estado', 'extraccionEstado'], _count: true }),
      this.prisma.contacto.groupBy({ by: ['rol', 'fuente'], _count: true }),
      this.prisma.ordenCompra.findFirst({ where: { fuente: 'BUSCADOR' }, orderBy: { fechaEnvio: 'desc' }, select: { codigo: true, fechaEnvio: true } }),
    ]);
    return {
      success: true,
      data: { organismos, proveedores, procesos, ordenes, ocAgSinProceso, adjudicaciones, documentos, contactos, ultimaOcTiempoReal: ultimaOc },
    };
  }

  /** Adjudicaciones con el enlace al proceso, el comprador, el proveedor y la OC. */
  @Get('adjudicaciones')
  async adjudicaciones(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('tipo') tipo?: string,
    @Query('rut') rut?: string,
    @Query('desde') desde?: string,
  ) {
    const lim = Math.min(200, Math.max(1, limit));
    const condiciones: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (tipo) condiciones.push(Prisma.sql`proceso_tipo::text = ${tipo}`);
    const r = normalizarRut(rut);
    if (r) condiciones.push(Prisma.sql`(proveedor_rut = ${r} OR comprador_rut = ${r})`);
    if (desde) condiciones.push(Prisma.sql`detectada_at >= ${new Date(desde)}`);
    const where = Prisma.join(condiciones, ' AND ');
    const data = await this.prisma.$queryRaw<unknown[]>`
      SELECT * FROM v_adjudicaciones WHERE ${where}
      ORDER BY detectada_at DESC LIMIT ${lim} OFFSET ${(Math.max(1, page) - 1) * lim}`;
    return { success: true, data, page, limit: lim };
  }

  @Get('empresas/:rut')
  async empresa(@Param('rut') rutCrudo: string) {
    const rut = normalizarRut(rutCrudo);
    const empresa = rut ? await this.prisma.empresa.findUnique({ where: { rut } }) : null;
    if (!empresa || !rut) throw new NotFoundException('RUT no encontrado');
    const [contactos, adjudicaciones, comoComprador] = await Promise.all([
      this.prisma.contacto.findMany({ where: { rut }, orderBy: [{ confianza: 'desc' }, { vecesVisto: 'desc' }], take: 100 }),
      this.prisma.$queryRaw<unknown[]>`SELECT * FROM v_adjudicaciones WHERE proveedor_rut = ${rut} ORDER BY detectada_at DESC LIMIT 100`,
      this.prisma.ordenCompra.aggregate({ where: { compradorRut: rut }, _count: true, _sum: { montoTotalClp: true } }),
    ]);
    return { success: true, data: { empresa, contactos, adjudicaciones, comoComprador } };
  }

  @Get('procesos/:codigo')
  async proceso(@Param('codigo') codigo: string) {
    const c = codigo.toUpperCase();
    const proceso = await this.prisma.proceso.findUnique({
      where: { codigo: c },
      include: {
        ofertas: { orderBy: [{ seleccionada: 'desc' }, { codigoItem: 'asc' }], take: 500 },
        adjudicaciones: true,
        documentos: { select: { id: true, nombre: true, tipoAnexo: true, mime: true, tamanoBytes: true, estado: true, extraccionEstado: true, metodoExtraccion: true, error: true } },
      },
    });
    if (!proceso) throw new NotFoundException(`Proceso ${c} no encontrado`);
    const [ordenes, contactos] = await Promise.all([
      this.prisma.ordenCompra.findMany({ where: { procesoCodigo: c }, select: { id: true, codigo: true, link: true, proveedorRut: true, proveedorNombre: true, montoTotalClp: true, fechaEnvio: true, estado: true } }),
      this.prisma.contacto.findMany({ where: { procesoCodigo: c }, orderBy: { confianza: 'desc' } }),
    ]);
    return { success: true, data: { proceso, ordenes, contactos } };
  }

  @Get('contactos')
  async contactos(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('rol') rol?: RolContacto,
    @Query('rut') rut?: string,
    @Query('minConfianza') minConfianza?: string,
  ) {
    const lim = Math.min(200, Math.max(1, limit));
    const where: Prisma.ContactoWhereInput = {
      ...(rol ? { rol } : {}),
      ...(normalizarRut(rut) ? { rut: normalizarRut(rut) } : {}),
      ...(minConfianza ? { confianza: { gte: Number(minConfianza) } } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.contacto.findMany({ where, orderBy: { ultimaVezVisto: 'desc' }, skip: (Math.max(1, page) - 1) * lim, take: lim }),
      this.prisma.contacto.count({ where }),
    ]);
    return { success: true, data, total, page, limit: lim };
  }
}
