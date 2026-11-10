import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { getErrorMessage } from '../common/errores';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { IngestaRepository } from '../ingesta/ingesta.repository';
import { AdjuntosClient } from '../mercado-publico/adjuntos.client';
import { PrismaService } from '../prisma/prisma.service';
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
    private readonly storage: StorageService,
    private readonly configuracion: ConfiguracionService,
    private readonly ingesta: IngestaRepository,
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
      } catch {
        fallidos++;
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
      const remotos = (await this.cliente.listar(codigo)).slice(0, maxArchivos);
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
          const base = { procesoCodigo: codigo, idExterno: a.idExterno, nombre, tipoAnexo: a.tipoAnexo, mime: archivo.mime, tamanoBytes: archivo.contenido.length };
          if (archivo.contenido.length > maxBytes) {
            await this.guardarDocumento({ ...base, estado: 'OMITIDO', error: `Pesa ${Math.round(archivo.contenido.length / 1048576)} MB` });
            continue;
          }
          const sha256 = createHash('sha256').update(archivo.contenido).digest('hex');
          const ruta = await this.storage.guardar(`procesos/${codigo}/${sha256.slice(0, 12)}_${nombreSeguro(nombre)}`, archivo.contenido, archivo.mime);
          await this.guardarDocumento({ ...base, sha256, rutaAlmacen: ruta, estado: 'DESCARGADO', descargadoAt: new Date(), error: null });
          nuevos++;
        } catch (error) {
          errores++;
          await this.guardarDocumento({ procesoCodigo: codigo, idExterno: a.idExterno, nombre: a.nombre, tipoAnexo: a.tipoAnexo, estado: 'ERROR', error: getErrorMessage(error).slice(0, 1000) });
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

  private guardarDocumento(d: {
    procesoCodigo: string; idExterno: string; nombre: string; tipoAnexo: string | null; estado: 'DESCARGADO' | 'OMITIDO' | 'ERROR';
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
