import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { esAnexoIdentificacion } from '../common/anexo1';
import { getErrorMessage } from '../common/errores';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { StorageService } from '../documentos/storage.service';
import { ContactosRepository } from '../ingesta/contactos.repository';
import { PrismaService } from '../prisma/prisma.service';
import { type ContextoProceso, extraerContactos } from './contactos.extractor';
import { TextoService } from './texto.service';

/**
 * Pasa los adjuntos descargados por extracción de texto (OCR si son
 * escaneados) y busca en ellos los contactos del comprador y del proveedor.
 */
@Injectable()
export class ExtraccionService {
  constructor(
    @InjectPinoLogger(ExtraccionService.name) private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly texto: TextoService,
    private readonly contactos: ContactosRepository,
    private readonly configuracion: ConfiguracionService,
  ) {}

  async contexto(procesoCodigo: string): Promise<ContextoProceso> {
    const proceso = await this.prisma.proceso.findUnique({ where: { codigo: procesoCodigo } });
    const [ofertas, adjudicaciones] = await Promise.all([
      this.prisma.oferta.findMany({ where: { procesoCodigo }, select: { proveedorRut: true, seleccionada: true } }),
      this.prisma.adjudicacion.findMany({ where: { procesoCodigo }, select: { proveedorRut: true } }),
    ]);
    const adjudicados = new Set([...adjudicaciones.map((a) => a.proveedorRut), ...ofertas.filter((o) => o.seleccionada).map((o) => o.proveedorRut)]);
    const ruts = [...new Set([...ofertas.map((o) => o.proveedorRut), ...adjudicados])];
    const empresas = await this.prisma.empresa.findMany({
      where: { rut: { in: [...ruts, ...(proceso?.compradorRut ? [proceso.compradorRut] : [])] } },
      select: { rut: true, razonSocial: true },
    });
    const nombre = new Map(empresas.map((e) => [e.rut, e.razonSocial]));
    return {
      compradorRut: proceso?.compradorRut ?? null,
      compradorNombre: (proceso?.compradorRut && nombre.get(proceso.compradorRut)) || proceso?.organismo || null,
      proveedores: ruts.map((rut) => ({ rut, nombre: nombre.get(rut) ?? null, adjudicado: adjudicados.has(rut) })),
    };
  }

  async procesarLote(): Promise<{ documentos: number; conTexto: number; contactos: number; fallidos: number }> {
    const lote = await this.configuracion.get('extraccion.lote');
    const docs = await this.prisma.documento.findMany({
      where: { estado: 'DESCARGADO', extraccionEstado: 'PENDIENTE' },
      orderBy: { descargadoAt: 'desc' },
      take: lote,
    });
    let conTexto = 0;
    let contactos = 0;
    let fallidos = 0;
    for (const d of docs) {
      try {
        const r = await this.procesarDocumento(d.id);
        if (r.texto) conTexto++;
        contactos += r.contactos;
      } catch {
        fallidos++;
      }
    }
    return { documentos: docs.length, conTexto, contactos, fallidos };
  }

  async procesarDocumento(id: string): Promise<{ texto: boolean; contactos: number }> {
    const d = await this.prisma.documento.findUniqueOrThrow({ where: { id } });
    if (!d.rutaAlmacen) throw new Error('Documento sin archivo');
    const ocrMaxPaginas = await this.configuracion.get('extraccion.ocr_max_paginas');
    const maxChars = await this.configuracion.get('extraccion.texto_max_chars');
    try {
      const contenido = await this.storage.leer(d.rutaAlmacen);
      const r = await this.texto.extraer(contenido, d.nombre, { ocrMaxPaginas, maxChars });
      // Los documentos del oferente van a Bedrock: ahí está el contacto del vendedor y el formato varía demasiado para el regex.
      const aIa = d.origen !== 'BASES' && (await this.configuracion.get('bedrock.habilitado'));
      await this.prisma.documento.update({
        where: { id },
        data: {
          texto: r.texto || null,
          metodoExtraccion: r.metodo,
          extraccionEstado: r.texto ? 'OK' : 'SIN_TEXTO',
          extraidoAt: new Date(),
          esAnexoIdentificacion: esAnexoIdentificacion(d.nombre, r.texto),
          analisisIaEstado: aIa ? 'PENDIENTE' : 'NO_APLICA',
        },
      });
      // Si el documento va a la IA, el regex no guarda nada: en los formularios del oferente arma
      // pares nombre–correo equivocados. Queda como respaldo con la IA apagada (o con /reanalizar).
      const n = r.texto && !aIa ? await this.contactosDeTexto(d.id, d.procesoCodigo, r.texto, d.proveedorRut) : 0;
      return { texto: Boolean(r.texto), contactos: n };
    } catch (error) {
      await this.prisma.documento.update({
        where: { id },
        data: { extraccionEstado: 'ERROR', error: getErrorMessage(error).slice(0, 1000), extraidoAt: new Date() },
      });
      this.logger.warn({ id, nombre: d.nombre, error: getErrorMessage(error) }, 'Falló la extracción');
      throw error;
    }
  }

  /** Vuelve a correr solo el extractor de contactos sobre el texto ya guardado. */
  async reanalizar(procesoCodigo: string): Promise<number> {
    const docs = await this.prisma.documento.findMany({
      where: { procesoCodigo, extraccionEstado: 'OK' },
      select: { id: true, texto: true, proveedorRut: true },
    });
    let total = 0;
    for (const d of docs) if (d.texto) total += await this.contactosDeTexto(d.id, procesoCodigo, d.texto, d.proveedorRut);
    return total;
  }

  private async contactosDeTexto(documentoId: string, procesoCodigo: string, texto: string, duenoRut: string | null): Promise<number> {
    const ctx = { ...(await this.contexto(procesoCodigo)), duenoRut };
    const encontrados = extraerContactos(texto, ctx);
    await this.contactos.guardar(
      encontrados.map((c) => ({ ...c, fuente: 'DOCUMENTO' as const, procesoCodigo, documentoId })),
    );
    return encontrados.length;
  }
}
