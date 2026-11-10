import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { codigoCompraAgilEnTexto } from '../common/codigos';
import { getErrorMessage } from '../common/errores';
import { enParalelo } from '../common/http';
import { fecha, hoyChile } from '../common/parse';
import { normalizarRut } from '../common/rut';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { IngestaRepository } from '../ingesta/ingesta.repository';
import type { AdjudicacionReg, EmpresaReg, OfertaReg } from '../ingesta/tipos';
import { BuscadorClient, ESTADO_CA, type FichaCompraAgil } from '../mercado-publico/buscador.client';
import { PrismaService } from '../prisma/prisma.service';
import { palabrasClave, prefijoUnidad } from './palabras';

interface OcSinProceso {
  id: bigint;
  codigo: string;
  nombre: string | null;
  descripcion: string | null;
  fechaEnvio: Date | null;
  compradorRut: string | null;
  proveedorRut: string | null;
  montoTotalClp: { toString(): string } | null;
}

/**
 * Cruza cada OC de compra ágil (AG) con su cotización (COT) y completa la
 * compra ágil con su ficha. Ni el CSV masivo ni el buscador de OC traen el
 * código de la compra ágil en un campo propio, así que:
 *  1. se lee del nombre/observaciones de la OC (~80% de los casos: MP lo
 *     escribe solo, "generada por invitación a compra ágil: 3485-1129-COT26");
 *  2. si no está, se busca en el buscador de compras ágiles con las palabras
 *     del nombre, en la ventana previa al envío, dejando solo las de la misma
 *     unidad de compra (1196-267-AG26 ↔ 1196-63-COT26) y confirmando en la
 *     ficha que `id_orden_compra` (o el `id_oc` de la cotización) es la OC.
 * Después se lee la ficha de cada compra ágil nueva: cotizaciones (quién
 * ofertó, por cuánto, quién quedó seleccionado) e institución compradora.
 */
@Injectable()
export class MatchCompraAgilService {
  constructor(
    @InjectPinoLogger(MatchCompraAgilService.name) private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    private readonly buscador: BuscadorClient,
    private readonly ingesta: IngestaRepository,
    private readonly configuracion: ConfiguracionService,
  ) {}

  /**
   * Cruza y lee fichas. Con `ids` (OC recién llegadas) solo trabaja esas y sus
   * compras ágiles; sin `ids` drena los pendientes de cualquier origen.
   */
  async procesar(ids?: bigint[]) {
    const { codigos, ...cruce } = await this.cruzarPendientes(ids);
    let deEstas: string[] | undefined;
    if (ids) {
      const ocs = await this.prisma.ordenCompra.findMany({ where: { id: { in: ids }, tipo: 'AG', procesoCodigo: { not: null } }, select: { procesoCodigo: true } });
      deEstas = [...new Set([...codigos, ...ocs.map((o) => o.procesoCodigo!)])];
    }
    const fichas = await this.leerFichasPendientes(deEstas);
    return { ...cruce, fichas };
  }

  /** Paso 1: OC AG sin proceso → código de su compra ágil. */
  async cruzarPendientes(ids?: bigint[]): Promise<{ intentadas: number; porTexto: number; porBusqueda: number; fallidas: number; codigos: string[] }> {
    const lote = await this.configuracion.get('match_compra_agil.lote');
    const maxIntentos = await this.configuracion.get('match_compra_agil.max_intentos');
    // En el ciclo de tiempo real (ids) no se busca por palabras: es lenta y la hace el cron de pendientes.
    const conBusqueda = !ids && (await this.configuracion.get('match_compra_agil.busqueda_por_palabras'));
    let busquedasRestantes = await this.configuracion.get('match_compra_agil.lote_busquedas');

    const ordenes: OcSinProceso[] = await this.prisma.ordenCompra.findMany({
      where: { tipo: 'AG', procesoCodigo: null, matchIntentos: { lt: maxIntentos }, ...(ids ? { id: { in: ids } } : {}) },
      // Primero las nunca intentadas y las más recientes: es lo que importa en tiempo real.
      orderBy: [{ matchIntentos: 'asc' }, { fechaEnvio: 'desc' }],
      take: lote,
      select: { id: true, codigo: true, nombre: true, descripcion: true, fechaEnvio: true, compradorRut: true, proveedorRut: true, montoTotalClp: true },
    });

    let porTexto = 0;
    let porBusqueda = 0;
    let fallidas = 0;
    const codigos: string[] = [];
    for (const oc of ordenes) {
      try {
        let codigo = codigoCompraAgilEnTexto(oc.nombre, oc.descripcion);
        if (codigo) porTexto++;
        else if (conBusqueda && busquedasRestantes > 0) {
          busquedasRestantes--;
          codigo = await this.buscarPorPalabras(oc);
          if (codigo) porBusqueda++;
        }
        if (codigo) {
          codigos.push(codigo);
          await this.amarrar(oc, codigo);
        }
        await this.prisma.ordenCompra.update({
          where: { id: oc.id },
          data: { matchIntentadoAt: new Date(), matchIntentos: { increment: 1 } },
        });
      } catch (error) {
        fallidas++;
        this.logger.warn({ oc: oc.codigo, error: getErrorMessage(error) }, 'Falló el cruce con compra ágil');
        await this.prisma.ordenCompra.update({ where: { id: oc.id }, data: { matchIntentadoAt: new Date(), matchIntentos: { increment: 1 } } });
      }
    }
    if (ordenes.length) this.logger.info({ intentadas: ordenes.length, porTexto, porBusqueda, fallidas }, 'Cruce OC ↔ compra ágil');
    return { intentadas: ordenes.length, porTexto, porBusqueda, fallidas, codigos };
  }

  /** Paso 2: compras ágiles sin ficha leída → cotizaciones e institución. */
  async leerFichasPendientes(codigos?: string[]): Promise<{ leidas: number; sinFicha: number; fallidas: number }> {
    const lote = await this.configuracion.get('compras_agiles.lote_fichas');
    const procesos = await this.prisma.proceso.findMany({
      where: { tipo: 'COMPRA_AGIL', detalleRevisadoAt: null, ...(codigos ? { codigo: { in: codigos } } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: lote,
      select: { codigo: true },
    });
    let sinFicha = 0;
    let fallidas = 0;
    await enParalelo(procesos, 3, async ({ codigo }) => {
      try {
        const ficha = await this.buscador.fichaCompraAgil(codigo);
        if (!ficha) {
          sinFicha++;
          await this.prisma.proceso.update({ where: { codigo }, data: { detalleRevisadoAt: new Date(), detalleError: 'El buscador no tiene ficha' } });
          return;
        }
        await this.guardarCompraAgil(ficha);
      } catch (error) {
        fallidas++;
        await this.prisma.proceso.update({ where: { codigo }, data: { detalleError: getErrorMessage(error).slice(0, 500) } });
      }
    });
    return { leidas: procesos.length, sinFicha, fallidas };
  }

  private async amarrar(oc: OcSinProceso, codigo: string) {
    await this.prisma.ordenCompra.update({ where: { id: oc.id }, data: { procesoCodigo: codigo } });
    if (!oc.proveedorRut) return;
    await this.ingesta.asegurarProcesos([{ codigo, compradorRut: oc.compradorRut }]);
    const nuevas = await this.ingesta.upsertAdjudicaciones([
      { procesoCodigo: codigo, proveedorRut: oc.proveedorRut, ordenCompraId: oc.id, monto: oc.montoTotalClp?.toString() ?? null, origen: 'ORDEN_COMPRA' },
    ]);
    if (nuevas.length && (await this.configuracion.get('adjuntos.auto_encolar_adjudicados'))) {
      await this.ingesta.encolarAdjuntos([codigo]);
    }
  }

  private async buscarPorPalabras(oc: OcSinProceso): Promise<string | null> {
    const palabras = palabrasClave(oc.nombre);
    if (!palabras) return null;
    const diasAtras = await this.configuracion.get('match_compra_agil.dias_atras');
    const envio = oc.fechaEnvio ?? new Date();
    const prefijo = `${prefijoUnidad(oc.codigo)}-`;

    const r = await this.buscador.buscarComprasAgiles({
      desde: hoyChile(-diasAtras, envio),
      hasta: hoyChile(0, envio),
      pagina: 1,
      estado: ESTADO_CA.PROVEEDOR_SELECCIONADO,
      palabras,
      rapido: true,
    });
    const candidatos = r.resultados.map((c) => c.codigo).filter((c) => c.startsWith(prefijo));
    for (const codigo of candidatos.slice(0, 4)) {
      const ficha = await this.buscador.fichaCompraAgil(codigo);
      if (!ficha) continue;
      const idsOc = new Set<number>([
        ...(ficha.id_orden_compra ? [ficha.id_orden_compra] : []),
        ...(ficha.proveedores_cotizando ?? []).map((c) => c.id_oc).filter((x): x is number => Boolean(x)),
      ]);
      if (!idsOc.has(Number(oc.id))) continue;
      await this.ingesta.asegurarProcesos([{ codigo, compradorRut: oc.compradorRut }]);
      await this.guardarCompraAgil(ficha);
      return codigo;
    }
    return null;
  }

  /** Guarda la compra ágil con su ficha: proceso, cotizaciones, OC que amarra y adjudicaciones. */
  async guardarCompraAgil(ficha: FichaCompraAgil): Promise<void> {
    const codigo = ficha.codigo.toUpperCase();
    const compradorRut = normalizarRut(ficha.informacion_institucion?.rut_organismo_comprador);
    const cotizaciones = ficha.proveedores_cotizando ?? [];

    const empresas: EmpresaReg[] = [];
    for (const c of cotizaciones) {
      const rut = normalizarRut(c.rut_proveedor);
      if (rut) empresas.push({ rut, razonSocial: c.razon_social ?? null, esOrganismo: false, esProveedor: true });
    }
    if (compradorRut) {
      empresas.push({ rut: compradorRut, razonSocial: ficha.informacion_institucion?.organismo_comprador ?? null, esOrganismo: true, esProveedor: false });
    }
    await this.ingesta.upsertEmpresas(empresas);

    const idsOc = [...new Set([ficha.id_orden_compra, ...cotizaciones.map((c) => c.id_oc)].filter((x): x is number => Boolean(x)))].map(BigInt);
    const ordenes = await this.prisma.ordenCompra.findMany({
      where: { OR: [{ id: { in: idsOc } }, { procesoCodigo: codigo }] },
      select: { id: true, proveedorRut: true, montoTotalClp: true, fechaEnvio: true, compradorRut: true },
    });

    await this.ingesta.upsertProcesos([{
      codigo,
      tipo: 'COMPRA_AGIL',
      codigoTipo: 'COT',
      idMp: ficha.detalle_id ? BigInt(ficha.detalle_id) : null,
      nombre: ficha.nombre?.slice(0, 500) ?? null,
      descripcion: ficha.descripcion?.slice(0, 4000) ?? null,
      link: `https://buscador.mercadopublico.cl/ficha?code=${codigo}`,
      estado: ficha.estado ?? null,
      compradorRut: compradorRut ?? ordenes[0]?.compradorRut ?? null,
      codigoOrganismo: null,
      organismo: ficha.informacion_institucion?.organismo_comprador ?? null,
      unidad: ficha.informacion_institucion?.division ?? null,
      region: null,
      fechaPublicacion: fecha(ficha.fecha_publicacion),
      fechaCierre: fecha(ficha.fecha_cierre),
      fechaAdjudicacion: ordenes[0]?.fechaEnvio ?? null,
      montoEstimado: ficha.presupuesto_estimado != null ? String(ficha.presupuesto_estimado) : null,
      moneda: ficha.moneda ?? null,
      numeroOferentes: ficha.total_ofertas_recibidas ?? cotizaciones.length,
      fuente: 'BUSCADOR',
    }]);

    const ofertas: OfertaReg[] = cotizaciones
      .filter((c) => normalizarRut(c.rut_proveedor))
      .map((c) => ({
        procesoCodigo: codigo,
        codigoItem: '0',
        correlativo: null,
        producto: null,
        proveedorRut: normalizarRut(c.rut_proveedor)!,
        nombreOferta: c.descripcion_cotizacion?.slice(0, 500) ?? null,
        estadoOferta: c.estado === 3 ? 'Inadmisible' : c.estado === 2 ? 'Enviada' : null,
        cantidadOfertada: null,
        montoUnitario: null,
        valorTotal: c.monto_total != null ? String(c.monto_total) : null,
        cantidadAdjudicada: null,
        montoAdjudicado: c.proveedor_seleccionado === 1 && c.monto_total != null ? String(c.monto_total) : null,
        seleccionada: c.proveedor_seleccionado === 1,
        fechaEnvio: fecha(c.fecha_creacion),
      }));
    await this.ingesta.upsertOfertas(ofertas);

    const enIds = ordenes.filter((o) => idsOc.includes(o.id));
    if (enIds.length) await this.prisma.ordenCompra.updateMany({ where: { id: { in: enIds.map((o) => o.id) } }, data: { procesoCodigo: codigo } });

    const adjudicaciones: AdjudicacionReg[] = ordenes
      .filter((o) => o.proveedorRut)
      .map((o) => ({ procesoCodigo: codigo, proveedorRut: o.proveedorRut!, ordenCompraId: o.id, monto: o.montoTotalClp?.toString() ?? null, origen: 'FICHA_COMPRA_AGIL' as const }));
    for (const g of cotizaciones.filter((c) => c.proveedor_seleccionado === 1)) {
      const rut = normalizarRut(g.rut_proveedor);
      if (rut && !adjudicaciones.some((a) => a.proveedorRut === rut)) {
        adjudicaciones.push({ procesoCodigo: codigo, proveedorRut: rut, ordenCompraId: g.id_oc ? BigInt(g.id_oc) : null, monto: g.monto_total != null ? String(g.monto_total) : null, origen: 'FICHA_COMPRA_AGIL' });
      }
    }
    const nuevas = await this.ingesta.upsertAdjudicaciones(adjudicaciones);
    if (nuevas.length && (await this.configuracion.get('adjuntos.auto_encolar_adjudicados'))) {
      await this.ingesta.encolarAdjuntos([codigo]);
    }
    await this.prisma.proceso.update({ where: { codigo }, data: { detalleRevisadoAt: new Date(), detalleError: null } });
  }
}
