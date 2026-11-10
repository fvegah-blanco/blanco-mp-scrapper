import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { getErrorMessage } from '../common/errores';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { IngestaRepository } from '../ingesta/ingesta.repository';
import { type AdjuntoRemoto, AdjuntosClient } from '../mercado-publico/adjuntos.client';
import { BuscadorClient } from '../mercado-publico/buscador.client';
import { OfertasClient, PortalBloqueadoError } from '../mercado-publico/ofertas.client';
import { PrismaService } from '../prisma/prisma.service';
import { MatchCompraAgilService } from '../tiempo-real/match-compra-agil.service';
import { StorageService } from './storage.service';

function nombreSeguro(nombre: string): string {
  return nombre.normalize('NFC').replace(/[^\p{L}\p{N}._() -]/gu, '_').slice(0, 150);
}

/**
 * Baja todos los adjuntos de los procesos encolados (adjuntos_estado =
 * PENDIENTE): bases, anexos, actas y ofertas públicas. Cada archivo queda en
 * `documentos` con su hash, listo para extraer texto/OCR.
 */
@Injectable()
export class AdjuntosService {
  constructor(
    @InjectPinoLogger(AdjuntosService.name) private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    private readonly cliente: AdjuntosClient,
    private readonly ofertas: OfertasClient,
    private readonly storage: StorageService,
    private readonly configuracion: ConfiguracionService,
    private readonly ingesta: IngestaRepository,
    private readonly compraAgil: MatchCompraAgilService,
    private readonly buscador: BuscadorClient,
  ) {}

  async encolar(codigos: string[], forzar = false): Promise<number> {
    const normal = codigos.map((c) => c.trim().toUpperCase()).filter(Boolean);
    await this.ingesta.asegurarProcesos(normal.map((codigo) => ({ codigo, compradorRut: null })));
    const r = await this.prisma.proceso.updateMany({
      where: { codigo: { in: normal }, ...(forzar ? {} : { adjuntosEstado: { in: ['NO_SOLICITADO', 'ERROR'] } }) },
      data: { adjuntosEstado: 'PENDIENTE', adjuntosIntentos: 0, adjuntosError: null },
    });
    return r.count;
  }

  async procesarLote(): Promise<{ procesos: number; archivos: number; fallidos: number }> {
    const lote = await this.configuracion.get('adjuntos.lote_procesos');
    const pendientes = await this.prisma.proceso.findMany({
      where: { adjuntosEstado: 'PENDIENTE' },
      orderBy: [{ adjuntosIntentos: 'asc' }, { updatedAt: 'desc' }],
      take: lote,
      select: { codigo: true },
    });
    let archivos = 0;
    let fallidos = 0;
    for (const { codigo } of pendientes) {
      try {
        archivos += await this.descargarProceso(codigo);
      } catch (error) {
        fallidos++;
        // El portal nos bloqueó: seguir solo empeora el baneo. Se retoma en la próxima corrida.
        if (error instanceof PortalBloqueadoError) {
          this.logger.warn({ codigo }, 'Portal de licitaciones respondió 403: se corta la corrida');
          break;
        }
      }
    }
    return { procesos: pendientes.length, archivos, fallidos };
  }

  /** Lista y baja los adjuntos de un proceso. Devuelve cuántos archivos nuevos guardó. */
  async descargarProceso(codigo: string): Promise<number> {
    const maxArchivos = await this.configuracion.get('adjuntos.max_archivos_por_proceso');
    const maxBytes = (await this.configuracion.get('adjuntos.max_mb_por_archivo')) * 1024 * 1024;
    const maxIntentos = await this.configuracion.get('adjuntos.max_intentos');
    try {
      const remotos: Array<AdjuntoRemoto & { origen?: 'BASES' | 'OFERTA' | 'COTIZACION'; proveedorRut?: string }> =
        (await this.cliente.listar(codigo)).slice(0, maxArchivos);
      if (await this.configuracion.get('adjuntos.documentos_adjudicado')) {
        try {
          remotos.push(...(await this.documentosDeAdjudicados(codigo)));
        } catch (error) {
          if (error instanceof PortalBloqueadoError) throw error;
          // Sin cuadro de ofertas o una respuesta rara: igual se guardan las bases.
          this.logger.warn({ codigo, error: getErrorMessage(error) }, 'No se pudieron listar los documentos del adjudicado');
        }
      }
      const ya = await this.prisma.documento.findMany({
        where: { procesoCodigo: codigo, estado: { in: ['DESCARGADO', 'OMITIDO'] } },
        select: { idExterno: true },
      });
      const hechos = new Set(ya.map((d) => d.idExterno));
      let nuevos = 0;
      let errores = 0;
      for (const a of remotos) {
        if (hechos.has(a.idExterno)) continue;
        try {
          const archivo = await a.descargar();
          const nombre = archivo.nombre ?? a.nombre;
          const base = {
            procesoCodigo: codigo, idExterno: a.idExterno, nombre, tipoAnexo: a.tipoAnexo, mime: archivo.mime, tamanoBytes: archivo.contenido.length,
            origen: a.origen ?? 'BASES', proveedorRut: a.proveedorRut ?? null,
          };
          if (archivo.contenido.length > maxBytes) {
            await this.guardarDocumento({ ...base, estado: 'OMITIDO', error: `Pesa ${Math.round(archivo.contenido.length / 1048576)} MB` });
            continue;
          }
          const sha256 = createHash('sha256').update(archivo.contenido).digest('hex');
          const carpeta = a.proveedorRut ? `procesos/${codigo}/oferentes/${a.proveedorRut}` : `procesos/${codigo}`;
          const ruta = await this.storage.guardar(`${carpeta}/${sha256.slice(0, 12)}_${nombreSeguro(nombre)}`, archivo.contenido, archivo.mime);
          await this.guardarDocumento({ ...base, sha256, rutaAlmacen: ruta, estado: 'DESCARGADO', descargadoAt: new Date(), error: null });
          nuevos++;
        } catch (error) {
          errores++;
          await this.guardarDocumento({
            procesoCodigo: codigo, idExterno: a.idExterno, nombre: a.nombre, tipoAnexo: a.tipoAnexo, estado: 'ERROR',
            origen: a.origen ?? 'BASES', proveedorRut: a.proveedorRut ?? null, error: getErrorMessage(error).slice(0, 1000),
          });
          if (error instanceof PortalBloqueadoError) throw error;
        }
      }
      await this.prisma.proceso.update({
        where: { codigo },
        data: {
          adjuntosEstado: errores > 0 && nuevos === 0 && remotos.length > 0 ? 'ERROR' : 'OK',
          adjuntosRevisadoAt: new Date(),
          adjuntosIntentos: { increment: 1 },
          adjuntosError: errores ? `${errores} de ${remotos.length} adjuntos fallaron` : null,
        },
      });
      this.logger.info({ codigo, encontrados: remotos.length, nuevos, errores }, 'Adjuntos del proceso');
      return nuevos;
    } catch (error) {
      const p = await this.prisma.proceso.update({
        where: { codigo },
        data: { adjuntosIntentos: { increment: 1 }, adjuntosError: getErrorMessage(error).slice(0, 1000), adjuntosRevisadoAt: new Date() },
      });
      if (p.adjuntosIntentos >= maxIntentos) {
        await this.prisma.proceso.update({ where: { codigo }, data: { adjuntosEstado: 'ERROR' } });
      }
      this.logger.warn({ codigo, error: getErrorMessage(error) }, 'No se pudieron listar los adjuntos');
      throw error;
    }
  }

  /**
   * Documentos del proveedor adjudicado, que es donde está el contacto del
   * vendedor: el Anexo N°1 del cuadro de ofertas (licitación) o los adjuntos de
   * la cotización ganadora (compra ágil).
   */
  private async documentosDeAdjudicados(codigo: string) {
    const proceso = await this.prisma.proceso.findUnique({ where: { codigo }, select: { tipo: true } });
    const adjudicados = await this.prisma.adjudicacion.findMany({ where: { procesoCodigo: codigo }, select: { proveedorRut: true }, distinct: ['proveedorRut'] });
    const out: Array<AdjuntoRemoto & { origen: 'OFERTA' | 'COTIZACION'; proveedorRut: string }> = [];

    if (proceso?.tipo === 'COMPRA_AGIL') {
      // Las cotizaciones (y su id_cotizacion) vienen de la ficha. Una compra ágil cruzada por el
      // COT del nombre de la OC puede llegar sin ficha leída, o leída antes de guardar el id: sin
      // esto solo bajarían las bases.
      const buscarCotizaciones = () =>
        this.prisma.oferta.findMany({
          where: { procesoCodigo: codigo, idExterno: { not: null }, OR: [{ seleccionada: true }, { proveedorRut: { in: adjudicados.map((a) => a.proveedorRut) } }] },
          select: { proveedorRut: true, idExterno: true },
        });
      let cotizaciones = await buscarCotizaciones();
      if (!cotizaciones.length) {
        const ficha = await this.buscador.fichaCompraAgil(codigo);
        if (ficha) {
          await this.compraAgil.guardarCompraAgil(ficha);
          cotizaciones = await buscarCotizaciones();
        }
      }
      for (const c of cotizaciones) {
        for (const a of await this.cliente.listarCotizacion(c.idExterno!, c.proveedorRut)) out.push({ ...a, origen: 'COTIZACION', proveedorRut: c.proveedorRut });
      }
      return out;
    }

    const pausaMs = await this.configuracion.get('adjuntos.pausa_ms');
    const soloAnexo1 = await this.configuracion.get('adjuntos.oferta_solo_anexo1');
    const maxAdministrativos = await this.configuracion.get('adjuntos.oferta_max_administrativos');
    for (const { proveedorRut } of adjudicados) {
      const r = await this.ofertas.oferente(codigo, proveedorRut, pausaMs);
      if (!r) continue;
      for (const a of await this.ofertas.adjuntos(r.sesion, r.oferente, { soloAnexo1, pausaMs, maxAdministrativos })) {
        out.push({ ...a, origen: 'OFERTA', proveedorRut });
      }
    }
    return out;
  }

  private guardarDocumento(d: {
    procesoCodigo: string; idExterno: string; nombre: string; tipoAnexo: string | null; estado: 'DESCARGADO' | 'OMITIDO' | 'ERROR';
    origen: 'BASES' | 'OFERTA' | 'COTIZACION'; proveedorRut: string | null;
    mime?: string | null; tamanoBytes?: number; sha256?: string; rutaAlmacen?: string; descargadoAt?: Date; error?: string | null;
  }) {
    const { procesoCodigo, idExterno, ...resto } = d;
    return this.prisma.documento.upsert({
      where: { procesoCodigo_idExterno: { procesoCodigo, idExterno } },
      create: { procesoCodigo, idExterno, ...resto },
      update: { ...resto, ...(d.estado === 'DESCARGADO' ? { extraccionEstado: 'PENDIENTE' as const } : {}) },
    });
  }
}
