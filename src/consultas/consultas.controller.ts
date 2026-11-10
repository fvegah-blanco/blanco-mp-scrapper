import { Controller, DefaultValuePipe, Get, NotFoundException, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Prisma, type RolContacto } from '@prisma/client';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { normalizarRut } from '../common/rut';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { PrismaService } from '../prisma/prisma.service';

/** Lectura de lo ingerido: resumen, adjudicaciones, fichas de empresa y proceso, contactos. */
@ApiTags('Consultas')
@ApiHeader({ name: 'x-admin-key', required: false })
@UseGuards(AdminKeyGuard)
@Controller('consultas')
export class ConsultasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionService,
  ) {}

  /**
   * Gasto y tiempos de la IA: totales y percentiles del período, gasto por día y
   * el detalle de cada documento (extracción + Bedrock, tokens, costo, contactos).
   */
  @Get('ia')
  async ia(@Query('dias', new DefaultValuePipe(30), ParseIntPipe) dias: number) {
    const desde = new Date(Date.now() - Math.min(365, Math.max(1, dias)) * 86_400_000);
    const [totales] = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        count(*) FILTER (WHERE analisis_ia_estado = 'OK')::int AS analizados,
        count(*) FILTER (WHERE analisis_ia_estado = 'ERROR')::int AS con_error,
        coalesce(sum(analisis_ia_costo_usd), 0)::float AS costo_usd,
        coalesce(sum(analisis_ia_tokens_entrada), 0)::int AS tokens_entrada,
        coalesce(sum(analisis_ia_tokens_salida), 0)::int AS tokens_salida,
        avg(analisis_ia_costo_usd) FILTER (WHERE analisis_ia_estado = 'OK')::float AS costo_promedio_usd,
        avg(analisis_ia_ms) FILTER (WHERE analisis_ia_estado = 'OK')::float AS ia_ms_promedio,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY analisis_ia_ms) FILTER (WHERE analisis_ia_estado = 'OK')::float AS ia_ms_p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY analisis_ia_ms) FILTER (WHERE analisis_ia_estado = 'OK')::float AS ia_ms_p95,
        avg(extraccion_ms)::float AS extraccion_ms_promedio
      FROM documentos WHERE analizado_ia_at >= ${desde}`;
    const [contactos] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM contactos WHERE fuente = 'DOCUMENTO_IA' AND created_at >= ${desde}`;
    const pendientes = await this.prisma.documento.count({ where: { analisisIaEstado: 'PENDIENTE' } });
    const porDia = await this.prisma.$queryRaw<unknown[]>`
      SELECT to_char(date_trunc('day', analizado_ia_at AT TIME ZONE 'America/Santiago'), 'YYYY-MM-DD') AS dia,
        count(*) FILTER (WHERE analisis_ia_estado = 'OK')::int AS analizados,
        count(*) FILTER (WHERE analisis_ia_estado = 'ERROR')::int AS con_error,
        coalesce(sum(analisis_ia_costo_usd), 0)::float AS costo_usd,
        avg(analisis_ia_ms) FILTER (WHERE analisis_ia_estado = 'OK')::float AS ia_ms_promedio
      FROM documentos WHERE analizado_ia_at >= ${desde}
      GROUP BY 1 ORDER BY 1 DESC`;
    const documentos = await this.prisma.$queryRaw<unknown[]>`
      SELECT d.id, d.nombre, d.proceso_codigo, d.origen, d.metodo_extraccion, d.es_anexo_identificacion,
        d.analisis_ia_estado, d.analisis_ia_modelo, d.analisis_ia_error, d.analizado_ia_at,
        d.extraccion_ms, d.analisis_ia_ms, d.analisis_ia_paginas, d.analisis_ia_tokens_entrada, d.analisis_ia_tokens_salida,
        d.analisis_ia_costo_usd::float AS costo_usd,
        (SELECT count(*)::int FROM contactos c WHERE c.documento_id = d.id AND c.fuente = 'DOCUMENTO_IA') AS contactos
      FROM documentos d WHERE d.analizado_ia_at >= ${desde}
      ORDER BY d.analizado_ia_at DESC LIMIT 200`;
    return {
      success: true,
      data: {
        dias,
        totales: { ...totales, contactos: contactos.n, pendientes },
        precio: {
          entradaUsdMtok: await this.configuracion.get('bedrock.precio_entrada_usd_mtok'),
          salidaUsdMtok: await this.configuracion.get('bedrock.precio_salida_usd_mtok'),
          dolarClp: await this.configuracion.get('ia.dolar_clp'),
          modelo: process.env.BEDROCK_MODEL ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        },
        porDia,
        documentos,
      },
    };
  }

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
