import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { codigoCompraAgilEnTexto } from '../common/codigos';
import { fecha, hoyChile } from '../common/parse';
import { normalizarRut } from '../common/rut';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { IngestaRepository } from '../ingesta/ingesta.repository';
import type { EmpresaReg, OrdenReg } from '../ingesta/tipos';
import type { OcBuscador } from '../mercado-publico/buscador.client';
import { BuscadorClient } from '../mercado-publico/buscador.client';
import { PrismaService } from '../prisma/prisma.service';
import { tipoOcDesdeCodigo } from './palabras';

const MARCA = 'oc_tiempo_real.ultima_fecha_envio';
const LINK_OC = 'https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=';

export function ordenDesdeBuscador(r: OcBuscador): OrdenReg {
  const tipo = tipoOcDesdeCodigo(r.codigo);
  return {
    id: BigInt(r.id),
    codigo: r.codigo,
    link: LINK_OC + r.codigo,
    nombre: r.nombre?.slice(0, 500) ?? null,
    descripcion: null,
    tipo,
    procedencia: null,
    esCompraAgil: tipo === 'AG',
    esTratoDirecto: tipo === 'TD',
    estado: r.estado ?? null,
    estadoProveedor: null,
    fechaCreacion: null,
    fechaEnvio: fecha(r.fecha_envio),
    fechaAceptacion: null,
    fechaCancelacion: null,
    montoTotal: r.monto_total != null ? String(r.monto_total) : null,
    moneda: r.moneda ?? null,
    montoTotalClp: r.moneda === 'CLP' && r.monto_total != null ? String(r.monto_total) : null,
    compradorRut: normalizarRut(r.rut_organismo_comprador),
    unidadCompra: r.unidad_compra ?? null,
    codigoUnidadCompra: r.codigo.split('-')[0],
    organismo: r.nombre_organismo_comprador ?? null,
    codigoOrganismo: null,
    proveedorRut: normalizarRut(r.rut_proveedor),
    proveedorNombre: r.nombre_proveedor ?? null,
    codigoProveedor: null,
    procesoCodigo: tipo === 'AG' ? codigoCompraAgilEnTexto(r.nombre) : null,
    convenioMarco: null,
    formaPago: null,
    fuente: 'BUSCADOR',
  };
}

/**
 * Poll del buscador de órdenes de compra (cada 30 min): baja las OC enviadas
 * desde la última vista (con solape) y devuelve las nuevas para que se lea su
 * ficha y se busque su proceso de origen en el mismo ciclo.
 */
@Injectable()
export class OcTiempoRealService {
  constructor(
    @InjectPinoLogger(OcTiempoRealService.name) private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    private readonly buscador: BuscadorClient,
    private readonly ingesta: IngestaRepository,
    private readonly configuracion: ConfiguracionService,
  ) {}

  async poll(): Promise<{ vistas: number; nuevas: bigint[]; paginas: number; hasta: string | null }> {
    const solapeMin = await this.configuracion.get('tiempo_real.solape_minutos');
    const maxPaginas = await this.configuracion.get('tiempo_real.max_paginas');
    const marca = await this.configuracion.leerMarca(MARCA);
    const ahora = new Date();
    // Sin marca se parte del inicio de hoy; nunca más de 2 días atrás (lo viejo lo trae el masivo).
    const corte = new Date(Math.max(
      marca ? new Date(marca).getTime() - solapeMin * 60_000 : fecha(`${hoyChile(0, ahora)} 00:00:00`)!.getTime(),
      ahora.getTime() - 2 * 86_400_000,
    ));
    const desde = hoyChile(0, corte);
    const hasta = hoyChile(0, ahora);

    const vistas: OrdenReg[] = [];
    let paginas = 0;
    for (let pagina = 1; pagina <= maxPaginas; pagina++) {
      const p = await this.buscador.buscarOrdenes({ desde, hasta, pagina });
      paginas++;
      const ordenes = p.resultados.map(ordenDesdeBuscador);
      vistas.push(...ordenes.filter((o) => !o.fechaEnvio || o.fechaEnvio >= corte));
      const masVieja = ordenes.at(-1)?.fechaEnvio;
      if (pagina >= p.pageCount || ordenes.length === 0 || (masVieja && masVieja < corte)) break;
    }

    if (vistas.length === 0) return { vistas: 0, nuevas: [], paginas, hasta: marca };

    const existentes = await this.prisma.ordenCompra.findMany({
      where: { id: { in: vistas.map((o) => o.id) } },
      select: { id: true },
    });
    const ya = new Set(existentes.map((e) => e.id));

    const empresas: EmpresaReg[] = [];
    for (const o of vistas) {
      if (o.compradorRut) empresas.push({ rut: o.compradorRut, razonSocial: o.organismo, esOrganismo: true, esProveedor: false });
      if (o.proveedorRut) empresas.push({ rut: o.proveedorRut, razonSocial: o.proveedorNombre, esOrganismo: false, esProveedor: true });
    }
    for (let i = 0; i < empresas.length; i += 1000) await this.ingesta.upsertEmpresas(empresas.slice(i, i + 1000));
    for (let i = 0; i < vistas.length; i += 500) await this.ingesta.upsertOrdenes(vistas.slice(i, i + 500));

    // OC de compra ágil con el COT en el nombre: la adjudicación sale altiro.
    const nuevasAdj = await this.ingesta.upsertAdjudicaciones(this.ingesta.adjudicacionesDeOrdenes(vistas));
    if (nuevasAdj.length && (await this.configuracion.get('adjuntos.auto_encolar_adjudicados'))) {
      await this.ingesta.encolarAdjuntos(nuevasAdj.map((clave) => clave.split('|')[0]));
    }

    const maxEnvio = vistas.reduce<Date | null>((m, o) => (o.fechaEnvio && (!m || o.fechaEnvio > m) ? o.fechaEnvio : m), null);
    if (maxEnvio && (!marca || maxEnvio > new Date(marca))) await this.configuracion.guardarMarca(MARCA, maxEnvio.toISOString());

    const nuevas = vistas.filter((o) => !ya.has(o.id)).map((o) => o.id);
    this.logger.info({ vistas: vistas.length, nuevas: nuevas.length, paginas, desde, hasta }, 'Poll de OC en tiempo real');
    return { vistas: vistas.length, nuevas, paginas, hasta: maxEnvio?.toISOString() ?? marca };
  }
}
