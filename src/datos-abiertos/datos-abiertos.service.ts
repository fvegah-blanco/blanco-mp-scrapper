import { Injectable } from '@nestjs/common';
import { type ArchivoMasivo, EstadoArchivo, TipoReporte } from '@prisma/client';
import { createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { join, resolve } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { getErrorMessage } from '../common/errores';
import { fetchMp } from '../common/http';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { IngestaRepository } from '../ingesta/ingesta.repository';
import type { AdjudicacionReg, EmpresaReg, ItemReg, OfertaReg, OrdenReg, ProcesoReg } from '../ingesta/tipos';
import { PrismaService } from '../prisma/prisma.service';
import { abrirCsvDeZip, abrirCsvLocal, recorrerCsv, type ResultadoLectura } from './lector-zip';
import { type FilaCsv, mapearFilaLic, mapearFilaOc } from './mapeo';

const BASE = 'https://transparenciachc.blob.core.windows.net';
const CONTENEDOR: Record<TipoReporte, string> = { OC: 'oc-da', LIC: 'lic-da' };

export function urlArchivo(tipo: TipoReporte, anio: number, mes: number): string {
  return `${BASE}/${CONTENEDOR[tipo]}/${anio}-${mes}.zip`;
}

interface Cabecera {
  existe: boolean;
  etag: string | null;
  lastModified: Date | null;
  tamano: bigint | null;
}

/** Un archivo que quedó DESCARGANDO/PROCESANDO más de esto se da por caído. */
const ATASCADO_MS = 3 * 60 * 60 * 1000;

/**
 * Descarga masiva por URL de datos-abiertos.chilecompra.cl: órdenes de compra
 * (oc-da) y licitaciones (lic-da), un .zip por mes. Mantiene al día el año en
 * curso (y los anteriores desde `datos_abiertos.anio_desde`): un mes se vuelve
 * a procesar solo si ChileCompra lo regeneró (cambia el ETag), lo que pasa a
 * diario con el mes abierto y cada vez que cambia el estado de una licitación
 * de un mes anterior.
 */
@Injectable()
export class DatosAbiertosService {
  constructor(
    @InjectPinoLogger(DatosAbiertosService.name) private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    private readonly ingesta: IngestaRepository,
    private readonly configuracion: ConfiguracionService,
  ) {}

  /** Meses (tipo × año × mes) que deberían existir hasta hoy. */
  async planificar(ahora = new Date()): Promise<Array<{ tipo: TipoReporte; anio: number; mes: number }>> {
    const desde = await this.configuracion.get('datos_abiertos.anio_desde');
    const anioActual = ahora.getFullYear();
    const mesActual = ahora.getMonth() + 1;
    const plan: Array<{ tipo: TipoReporte; anio: number; mes: number }> = [];
    // Licitaciones primero: así las OC encuentran el proceso ya creado.
    for (const tipo of [TipoReporte.LIC, TipoReporte.OC]) {
      for (let anio = Math.min(desde, anioActual); anio <= anioActual; anio++) {
        const ultimoMes = anio === anioActual ? mesActual : 12;
        for (let mes = 1; mes <= ultimoMes; mes++) plan.push({ tipo, anio, mes });
      }
    }
    return plan;
  }

  async cabecera(url: string): Promise<Cabecera> {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
    if (res.status === 404) return { existe: false, etag: null, lastModified: null, tamano: null };
    if (!res.ok) throw new Error(`HEAD ${url} → HTTP ${res.status}`);
    const lm = res.headers.get('last-modified');
    const largo = res.headers.get('content-length');
    return {
      existe: true,
      etag: res.headers.get('etag'),
      lastModified: lm ? new Date(lm) : null,
      tamano: largo ? BigInt(largo) : null,
    };
  }

  /**
   * Recorre el plan y procesa lo que falta o cambió. `forzar` reprocesa aunque
   * el ETag no haya cambiado.
   */
  async sincronizar(opciones: { forzar?: boolean; tipo?: TipoReporte; anio?: number; mes?: number } = {}) {
    let plan = await this.planificar();
    if (opciones.tipo) plan = plan.filter((p) => p.tipo === opciones.tipo);
    if (opciones.anio) plan = plan.filter((p) => p.anio === opciones.anio);
    if (opciones.mes) plan = plan.filter((p) => p.mes === opciones.mes);

    let procesados = 0;
    let fallidos = 0;
    let sinCambios = 0;
    let filas = 0;
    const detalle: string[] = [];
    for (const { tipo, anio, mes } of plan) {
      try {
        const r = await this.procesarMes(tipo, anio, mes, opciones.forzar ?? false);
        if (r === 'sin-cambios' || r === 'no-existe') {
          sinCambios++;
          continue;
        }
        procesados++;
        filas += r.leidas;
        detalle.push(`${tipo} ${anio}-${mes}: ${r.leidas} filas`);
      } catch (error) {
        fallidos++;
        detalle.push(`${tipo} ${anio}-${mes}: ERROR ${getErrorMessage(error)}`);
      }
    }
    return { procesados, fallidos, sinCambios, filas, detalle };
  }

  async procesarMes(
    tipo: TipoReporte,
    anio: number,
    mes: number,
    forzar = false,
  ): Promise<ResultadoLectura | 'sin-cambios' | 'no-existe'> {
    const url = urlArchivo(tipo, anio, mes);
    const cab = await this.cabecera(url);
    if (!cab.existe) return 'no-existe';

    const archivo = await this.prisma.archivoMasivo.upsert({
      where: { tipo_anio_mes: { tipo, anio, mes } },
      create: { tipo, anio, mes, url },
      update: {},
    });

    const enCurso = archivo.estado === EstadoArchivo.DESCARGANDO || archivo.estado === EstadoArchivo.PROCESANDO;
    if (enCurso && archivo.iniciadoAt && Date.now() - archivo.iniciadoAt.getTime() < ATASCADO_MS) {
      return 'sin-cambios';
    }
    if (!forzar && archivo.estado === EstadoArchivo.OK && archivo.etag === cab.etag) {
      return 'sin-cambios';
    }

    await this.marcar(archivo, { estado: EstadoArchivo.DESCARGANDO, iniciadoAt: new Date(), error: null });
    const dir = resolve(process.env.TMP_DIR ?? './tmp');
    await mkdir(dir, { recursive: true });
    const rutaZip = join(dir, `${CONTENEDOR[tipo]}-${anio}-${mes}-${Date.now()}.zip`);
    try {
      this.logger.info({ tipo, anio, mes, tamano: cab.tamano?.toString() }, 'Descargando archivo masivo');
      const res = await fetchMp(url, { timeoutMs: 15 * 60_000, reintentos: 2 });
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(rutaZip));

      await this.marcar(archivo, { estado: EstadoArchivo.PROCESANDO });
      const resultado = await this.procesarCsv(tipo, await abrirCsvDeZip(rutaZip));

      await this.marcar(archivo, {
        estado: EstadoArchivo.OK,
        etag: cab.etag,
        lastModified: cab.lastModified,
        tamanoBytes: cab.tamano,
        filasLeidas: resultado.leidas,
        filasError: resultado.conError,
        terminadoAt: new Date(),
      });
      this.logger.info({ tipo, anio, mes, ...resultado }, 'Archivo masivo procesado');
      return resultado;
    } catch (error) {
      await this.marcar(archivo, { estado: EstadoArchivo.ERROR, error: getErrorMessage(error).slice(0, 2000), terminadoAt: new Date() });
      throw error;
    } finally {
      await rm(rutaZip, { force: true });
    }
  }

  /** Procesa un CSV ya descargado (p.ej. ~/Downloads/2026-11.csv) sin pasar por el zip. */
  async importarCsvLocal(tipo: TipoReporte, ruta: string): Promise<ResultadoLectura> {
    return this.procesarCsv(tipo, abrirCsvLocal(ruta));
  }

  private async procesarCsv(tipo: TipoReporte, entrada: Readable): Promise<ResultadoLectura> {
    const lote = await this.configuracion.get('datos_abiertos.lote_filas');
    if (tipo === TipoReporte.OC) {
      const guardarItems = await this.configuracion.get('datos_abiertos.guardar_items_oc');
      return recorrerCsv(entrada, lote, (filas) => this.loteOc(filas, guardarItems));
    }
    // Las adjudicaciones de licitación se suman por proveedor en todo el archivo:
    // las filas de un mismo proceso pueden caer en lotes distintos.
    const adjudicados = new Map<string, AdjudicacionReg>();
    const resultado = await recorrerCsv(entrada, lote, (filas) => this.loteLic(filas, adjudicados));
    const regs = [...adjudicados.values()];
    for (let i = 0; i < regs.length; i += 1000) {
      await this.ingesta.upsertAdjudicaciones(regs.slice(i, i + 1000));
    }
    return resultado;
  }

  private async loteOc(filas: FilaCsv[], guardarItems: boolean): Promise<void> {
    const ordenes: OrdenReg[] = [];
    const items: ItemReg[] = [];
    const empresas: EmpresaReg[] = [];
    for (const f of filas) {
      const m = mapearFilaOc(f);
      if (!m) continue;
      ordenes.push(m.orden);
      if (m.item) items.push(m.item);
      empresas.push(...m.empresas);
    }
    await this.ingesta.upsertEmpresas(empresas);
    await this.ingesta.upsertOrdenes(ordenes);
    if (guardarItems) await this.ingesta.upsertItems(items);
    await this.ingesta.upsertAdjudicaciones(this.ingesta.adjudicacionesDeOrdenes(ordenes));
  }

  private async loteLic(filas: FilaCsv[], adjudicados: Map<string, AdjudicacionReg>): Promise<void> {
    const procesos: ProcesoReg[] = [];
    const ofertas: OfertaReg[] = [];
    const empresas: EmpresaReg[] = [];
    for (const f of filas) {
      const m = mapearFilaLic(f);
      if (!m) continue;
      procesos.push(m.proceso);
      empresas.push(...m.empresas);
      if (!m.oferta) continue;
      ofertas.push(m.oferta);
      if (m.oferta.seleccionada) {
        const clave = `${m.oferta.procesoCodigo}|${m.oferta.proveedorRut}`;
        const previo = adjudicados.get(clave);
        const monto = Number(m.oferta.montoAdjudicado ?? 0) + Number(previo?.monto ?? 0);
        adjudicados.set(clave, {
          procesoCodigo: m.oferta.procesoCodigo,
          proveedorRut: m.oferta.proveedorRut,
          ordenCompraId: null,
          monto: monto ? monto.toFixed(2) : null,
          origen: 'OFERTA_SELECCIONADA',
        });
      }
    }
    await this.ingesta.upsertEmpresas(empresas);
    await this.ingesta.upsertProcesos(procesos);
    await this.ingesta.upsertOfertas(ofertas);
  }

  private marcar(archivo: ArchivoMasivo, data: Partial<ArchivoMasivo>) {
    return this.prisma.archivoMasivo.update({ where: { id: archivo.id }, data });
  }

  async listar(anio?: number) {
    return this.prisma.archivoMasivo.findMany({
      where: anio ? { anio } : undefined,
      orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { tipo: 'asc' }],
    });
  }

  /** Estado del plan: qué meses faltan, cuáles están al día y cuáles cambiaron en origen. */
  async estado() {
    const plan = await this.planificar();
    const archivos = await this.prisma.archivoMasivo.findMany();
    const mapa = new Map(archivos.map((a) => [`${a.tipo}|${a.anio}|${a.mes}`, a]));
    return plan.map((p) => {
      const a = mapa.get(`${p.tipo}|${p.anio}|${p.mes}`);
      return {
        ...p,
        url: urlArchivo(p.tipo, p.anio, p.mes),
        estado: a?.estado ?? 'FALTA',
        filasLeidas: a?.filasLeidas ?? 0,
        filasError: a?.filasError ?? 0,
        terminadoAt: a?.terminadoAt ?? null,
        error: a?.error ?? null,
      };
    });
  }
}
