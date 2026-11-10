import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { deduplicar, upsertLote } from '../common/upsert';
import {
  type AdjudicacionReg,
  combinarEmpresas,
  type EmpresaReg,
  type ItemReg,
  type OfertaReg,
  type OrdenReg,
  type ProcesoReg,
  tipoDesdeCodigo,
} from './tipos';

const COALESCE = (col: string, tabla: string) => `COALESCE(EXCLUDED."${col}", "${tabla}"."${col}")`;

/**
 * Escritura masiva compartida por el sync de datos abiertos, el poll en tiempo
 * real y el cruce de compras ágiles. Todo es idempotente: reprocesar un mes o
 * una OC deja el mismo resultado.
 */
@Injectable()
export class IngestaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertEmpresas(regs: EmpresaReg[]): Promise<number> {
    const filas = deduplicar(regs, (e) => e.rut, combinarEmpresas);
    const t = 'empresas';
    return upsertLote(
      this.prisma,
      {
        tabla: t,
        columnas: ['rut', 'razon_social', 'es_organismo', 'es_proveedor', 'codigo_organismo', 'codigo_proveedor', 'sector', 'actividad', 'comuna', 'region'],
        conflicto: ['rut'],
        actualizar: {
          razon_social: COALESCE('razon_social', t),
          es_organismo: `"${t}"."es_organismo" OR EXCLUDED."es_organismo"`,
          es_proveedor: `"${t}"."es_proveedor" OR EXCLUDED."es_proveedor"`,
          codigo_organismo: COALESCE('codigo_organismo', t),
          codigo_proveedor: COALESCE('codigo_proveedor', t),
          sector: COALESCE('sector', t),
          actividad: COALESCE('actividad', t),
          comuna: COALESCE('comuna', t),
          region: COALESCE('region', t),
          ultima_vez_vista: 'now()',
          updated_at: 'now()',
        },
      },
      filas.map((e) => [e.rut, e.razonSocial, e.esOrganismo, e.esProveedor, e.codigoOrganismo ?? null, e.codigoProveedor ?? null, e.sector ?? null, e.actividad ?? null, e.comuna ?? null, e.region ?? null]),
    );
  }

  async upsertProcesos(regs: ProcesoReg[]): Promise<number> {
    const filas = deduplicar(regs, (p) => p.codigo);
    const t = 'procesos';
    const cols = ['codigo', 'tipo', 'codigo_tipo', 'id_mp', 'nombre', 'descripcion', 'link', 'estado', 'comprador_rut', 'codigo_organismo', 'organismo', 'unidad', 'region', 'fecha_publicacion', 'fecha_cierre', 'fecha_adjudicacion', 'monto_estimado', 'moneda', 'numero_oferentes', 'fuente'];
    const actualizar: Record<string, string> = { updated_at: 'now()' };
    for (const c of cols.slice(1)) actualizar[c] = COALESCE(c, t);
    // Un proceso mínimo creado desde una OC (tipo OTRO) se corrige cuando llega el real.
    actualizar.tipo = `CASE WHEN EXCLUDED."tipo" = 'OTRO' THEN "${t}"."tipo" ELSE EXCLUDED."tipo" END`;
    return upsertLote(
      this.prisma,
      { tabla: t, columnas: cols, conflicto: ['codigo'], actualizar },
      filas.map((p) => [p.codigo, p.tipo, p.codigoTipo, p.idMp, p.nombre, p.descripcion, p.link, p.estado, p.compradorRut, p.codigoOrganismo, p.organismo, p.unidad, p.region, p.fechaPublicacion, p.fechaCierre, p.fechaAdjudicacion, p.montoEstimado, p.moneda, p.numeroOferentes, p.fuente]),
    );
  }

  /**
   * Crea el proceso mínimo que referencia una OC o adjudicación cuando todavía
   * no llegó por su propia fuente (licitación de otro año, compra ágil).
   */
  async asegurarProcesos(minimos: Array<{ codigo: string; compradorRut: string | null }>): Promise<void> {
    if (minimos.length === 0) return;
    const regs: ProcesoReg[] = deduplicar(minimos, (m) => m.codigo).map((m) => {
      const { tipo, codigoTipo } = tipoDesdeCodigo(m.codigo);
      return {
        codigo: m.codigo, tipo, codigoTipo, idMp: null, nombre: null, descripcion: null,
        link: tipo === 'COMPRA_AGIL'
          ? `https://buscador.mercadopublico.cl/ficha?code=${m.codigo}`
          : `https://www.mercadopublico.cl/fichaLicitacion.html?idLicitacion=${m.codigo}`,
        estado: null, compradorRut: m.compradorRut, codigoOrganismo: null, organismo: null, unidad: null,
        region: null, fechaPublicacion: null, fechaCierre: null, fechaAdjudicacion: null, montoEstimado: null,
        moneda: null, numeroOferentes: null, fuente: 'FICHA',
      };
    });
    const t = 'procesos';
    await upsertLote(
      this.prisma,
      { tabla: t, columnas: ['codigo', 'tipo', 'codigo_tipo', 'link', 'comprador_rut', 'fuente'], conflicto: ['codigo'], actualizar: {
        tipo: `"${t}"."tipo"`, codigo_tipo: COALESCE('codigo_tipo', t), link: `COALESCE("${t}"."link", EXCLUDED."link")`,
        comprador_rut: `COALESCE("${t}"."comprador_rut", EXCLUDED."comprador_rut")`, fuente: `"${t}"."fuente"`,
      } },
      regs.map((p) => [p.codigo, p.tipo, p.codigoTipo, p.link, p.compradorRut, p.fuente]),
    );
  }

  async upsertOfertas(regs: OfertaReg[]): Promise<number> {
    // Si un proveedor manda dos ofertas al mismo ítem, se queda la seleccionada.
    const filas = deduplicar(regs, (o) => `${o.procesoCodigo}|${o.codigoItem}|${o.proveedorRut}`, (a, b) => (a.seleccionada && !b.seleccionada ? a : b));
    return upsertLote(
      this.prisma,
      {
        tabla: 'ofertas',
        columnas: ['proceso_codigo', 'codigo_item', 'correlativo', 'producto', 'proveedor_rut', 'nombre_oferta', 'estado_oferta', 'cantidad_ofertada', 'monto_unitario', 'valor_total', 'cantidad_adjudicada', 'monto_adjudicado', 'seleccionada', 'fecha_envio'],
        conflicto: ['proceso_codigo', 'codigo_item', 'proveedor_rut'],
        actualizar: { updated_at: 'now()' },
      },
      filas.map((o) => [o.procesoCodigo, o.codigoItem, o.correlativo, o.producto, o.proveedorRut, o.nombreOferta, o.estadoOferta, o.cantidadOfertada, o.montoUnitario, o.valorTotal, o.cantidadAdjudicada, o.montoAdjudicado, o.seleccionada, o.fechaEnvio]),
    );
  }

  async upsertOrdenes(regs: OrdenReg[]): Promise<number> {
    const filas = deduplicar(regs, (o) => o.id.toString());
    const t = 'ordenes_compra';
    const cols = ['id', 'codigo', 'link', 'nombre', 'descripcion', 'tipo', 'procedencia', 'es_compra_agil', 'es_trato_directo', 'estado', 'estado_proveedor', 'fecha_creacion', 'fecha_envio', 'fecha_aceptacion', 'fecha_cancelacion', 'monto_total', 'moneda', 'monto_total_clp', 'comprador_rut', 'unidad_compra', 'codigo_unidad_compra', 'organismo', 'codigo_organismo', 'proveedor_rut', 'proveedor_nombre', 'codigo_proveedor', 'proceso_codigo', 'convenio_marco', 'forma_pago', 'fuente'];
    const actualizar: Record<string, string> = { updated_at: 'now()' };
    for (const c of cols.slice(1)) actualizar[c] = COALESCE(c, t);
    // La fuente queda la primera que la vio: así se sabe qué llegó en tiempo real.
    actualizar.fuente = `"${t}"."fuente"`;
    return upsertLote(
      this.prisma,
      { tabla: t, columnas: cols, conflicto: ['id'], actualizar },
      filas.map((o) => [o.id, o.codigo, o.link, o.nombre, o.descripcion, o.tipo, o.procedencia, o.esCompraAgil, o.esTratoDirecto, o.estado, o.estadoProveedor, o.fechaCreacion, o.fechaEnvio, o.fechaAceptacion, o.fechaCancelacion, o.montoTotal, o.moneda, o.montoTotalClp, o.compradorRut, o.unidadCompra, o.codigoUnidadCompra, o.organismo, o.codigoOrganismo, o.proveedorRut, o.proveedorNombre, o.codigoProveedor, o.procesoCodigo, o.convenioMarco, o.formaPago, o.fuente]),
    );
  }

  async upsertItems(regs: ItemReg[]): Promise<number> {
    const filas = deduplicar(regs, (i) => i.id.toString());
    return upsertLote(
      this.prisma,
      {
        tabla: 'orden_compra_items',
        columnas: ['id', 'orden_compra_id', 'codigo_producto_onu', 'producto', 'rubro', 'especificacion_comprador', 'especificacion_proveedor', 'cantidad', 'unidad_medida', 'precio_neto', 'total_linea_neto'],
        conflicto: ['id'],
      },
      filas.map((i) => [i.id, i.ordenCompraId, i.codigoProductoOnu, i.producto, i.rubro, i.especificacionComprador, i.especificacionProveedor, i.cantidad, i.unidadMedida, i.precioNeto, i.totalLineaNeto]),
    );
  }

  /** Devuelve las claves que se insertaron por primera vez (adjudicaciones nuevas). */
  async upsertAdjudicaciones(regs: AdjudicacionReg[]): Promise<string[]> {
    if (regs.length === 0) return [];
    await this.asegurarProcesos(regs.map((r) => ({ codigo: r.procesoCodigo, compradorRut: null })));
    const conClave = regs.map((r) => ({
      ...r,
      clave: `${r.procesoCodigo}|${r.proveedorRut}|${r.ordenCompraId ?? 'oferta'}`,
    }));
    const filas = deduplicar(conClave, (r) => r.clave);
    const existentes = await this.prisma.adjudicacion.findMany({
      where: { clave: { in: filas.map((f) => f.clave) } },
      select: { clave: true },
    });
    const ya = new Set(existentes.map((e) => e.clave));
    await upsertLote(
      this.prisma,
      {
        tabla: 'adjudicaciones',
        columnas: ['clave', 'proceso_codigo', 'proveedor_rut', 'orden_compra_id', 'monto', 'origen'],
        conflicto: ['clave'],
        actualizar: { monto: COALESCE('monto', 'adjudicaciones'), updated_at: 'now()' },
        noActualizar: ['origen'],
      },
      filas.map((f) => [f.clave, f.procesoCodigo, f.proveedorRut, f.ordenCompraId, f.monto, f.origen]),
    );
    return filas.map((f) => f.clave).filter((c) => !ya.has(c));
  }

  /** Pide bajar los adjuntos de estos procesos (los que nunca se pidieron). */
  async encolarAdjuntos(codigos: string[]): Promise<number> {
    if (codigos.length === 0) return 0;
    const r = await this.prisma.proceso.updateMany({
      where: { codigo: { in: [...new Set(codigos)] }, adjuntosEstado: 'NO_SOLICITADO' },
      data: { adjuntosEstado: 'PENDIENTE' },
    });
    return r.count;
  }

  /** Adjudicaciones que salen de las OC con licitación de origen (no convenio marco). */
  adjudicacionesDeOrdenes(ordenes: OrdenReg[]): AdjudicacionReg[] {
    return ordenes
      .filter((o) => o.procesoCodigo && o.proveedorRut && o.tipo !== 'CM')
      .map((o) => ({
        procesoCodigo: o.procesoCodigo!,
        proveedorRut: o.proveedorRut!,
        ordenCompraId: o.id,
        monto: o.montoTotalClp,
        origen: 'ORDEN_COMPRA' as const,
      }));
  }
}
