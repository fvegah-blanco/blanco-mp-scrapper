import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createBedrockMantle } from '@ai-sdk/amazon-bedrock/mantle';
import { Injectable } from '@nestjs/common';
import type { Documento, Prisma } from '@prisma/client';
import { generateText, type LanguageModel, Output, type UserContent } from 'ai';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { getErrorMessage } from '../common/errores';
import { normalizarRut } from '../common/rut';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { StorageService } from '../documentos/storage.service';
import { type ContactoReg, ContactosRepository, normalizarEmail, normalizarTelefono } from '../ingesta/contactos.repository';
import { DOMINIOS_PUBLICOS } from './contactos.extractor';
import { PrismaService } from '../prisma/prisma.service';
import { extension, TextoService } from './texto.service';

/**
 * Luna (el tier barato del back office, por Mantle) lee igual que Haiku 4.5 a ~27% del costo
 * (comparado sobre 71 documentos, scripts/comparar-modelo.ts). Si Mantle falla —se cayó el
 * 05-11-2026— el documento se reintenta con Haiku por Converse.
 */
const MODELO_POR_DEFECTO = 'openai.gpt-5.6-luna';
const MODELO_RESPALDO_POR_DEFECTO = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
export const modeloPrincipal = () => process.env.BEDROCK_MODEL ?? MODELO_POR_DEFECTO;
export const modeloRespaldo = () => process.env.BEDROCK_MODEL_RESPALDO ?? MODELO_RESPALDO_POR_DEFECTO;
const REGION_POR_DEFECTO = 'us-east-2';
const MAX_CHARS_TEXTO = 8000;

export const esquemaAnexo = z.object({
  es_anexo_identificacion: z.boolean().describe('true si es el Anexo N°1 / formulario de identificación del oferente'),
  razon_social: z.string().describe('Razón social del oferente; "" si no aparece'),
  rut_empresa: z.string().describe('RUT del oferente en formato chileno; "" si no aparece'),
  contactos: z.array(z.object({
    rol: z.enum(['representante_legal', 'contacto', 'comprador', 'otro']),
    nombre: z.string(),
    cargo: z.string(),
    telefono: z.string(),
    email: z.string(),
    rut: z.string(),
  })).describe('Personas con sus datos de contacto; normalmente 1-2 del oferente'),
});
export type AnalisisAnexo = z.infer<typeof esquemaAnexo>;

export const SISTEMA = `Eres un extractor de datos de documentos de compras públicas de Chile (Mercado Público).
Recibes un documento que subió un proveedor en una licitación o compra ágil: normalmente el "ANEXO N°1 / Formulario de identificación del oferente", o una cotización con membrete.
El formato varía entre organismos: "CAMPO: valor", campos numerados, tablas, etiquetas sin dos puntos, escaneos.

Extrae los datos de contacto del OFERENTE (el proveedor que presenta la oferta):
- razón social y RUT de la empresa;
- el REPRESENTANTE LEGAL (nombre, RUT, teléfono, correo) → rol "representante_legal";
- el CONTACTO comercial u operativo (nombre, cargo, teléfono, correo) → rol "contacto".
Si el documento trae datos de contacto del ORGANISMO COMPRADOR (unidad de compra, contraparte técnica), inclúyelos con rol "comprador".

Reglas:
- No inventes datos. Si un campo no está, devuelve "".
- No incluyas terceros (notarios, bancos, Mercado Público).
- Si se entrega el TEXTO EXTRAÍDO, copia de ahí los valores exactos (correos, RUT, teléfonos): es fiel carácter por carácter. Usa las imágenes para entender quién es quién. Si difieren, confía en el texto.
- Si no hay ningún dato de contacto, devuelve contactos = [].`;

/**
 * Lectura con Bedrock de los documentos del oferente (Anexo N°1 y adjuntos de
 * cotizaciones). Ahí el regex no alcanza: en sii_situacion_tributaria el
 * regex resolvía 1 de 5 Anexos N°1 y el modelo con visión 5 de 5, incluidos
 * escaneos. Se manda el texto extraído como fuente fiel y las primeras
 * páginas como imagen. Las bases del comprador no pasan por acá.
 */
@Injectable()
export class AnalisisIaService {
  readonly modeloId = modeloPrincipal();
  readonly modeloRespaldoId = modeloRespaldo();
  private readonly modelos = new Map<string, LanguageModel>();

  constructor(
    @InjectPinoLogger(AnalisisIaService.name) private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly texto: TextoService,
    private readonly contactos: ContactosRepository,
    private readonly configuracion: ConfiguracionService,
  ) {}

  /** Hay credenciales: BEDROCK_AWS_* como el back office, o la cadena por defecto de AWS si BEDROCK_USE_DEFAULT_CREDENTIALS=true. */
  get disponible(): boolean {
    return Boolean(process.env.BEDROCK_AWS_ACCESS_KEY_ID || process.env.BEDROCK_USE_DEFAULT_CREDENTIALS === 'true');
  }

  /** `openai.*` va por Mantle (endpoint OpenAI-compatible de Bedrock); el resto por Converse, como en libs/ai. */
  private obtenerModelo(id: string): LanguageModel {
    let modelo = this.modelos.get(id);
    if (!modelo) {
      const credenciales = process.env.BEDROCK_AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.BEDROCK_AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.BEDROCK_AWS_SECRET_ACCESS_KEY,
            sessionToken: process.env.BEDROCK_AWS_SESSION_TOKEN,
          }
        : {};
      const region = process.env.BEDROCK_AWS_REGION ?? process.env.BEDROCK_REGION ?? REGION_POR_DEFECTO;
      modelo = id.startsWith('openai.')
        ? createBedrockMantle({ region, ...credenciales, baseURL: `https://bedrock-mantle.${region}.api.aws/openai/v1` }).responses(id)
        : createAmazonBedrock({ region, ...credenciales })(id);
      this.modelos.set(id, modelo);
    }
    return modelo;
  }

  /** Llama al modelo principal; si falla la llamada, al de respaldo. Devuelve qué modelo respondió. */
  private async leer(contenido: UserContent) {
    const llamar = (id: string) =>
      generateText({
        model: this.obtenerModelo(id),
        system: SISTEMA,
        messages: [{ role: 'user', content: contenido }],
        output: Output.object({ schema: esquemaAnexo }),
        ...(/claude-haiku-4-5/.test(id) ? { providerOptions: { bedrock: { structuredOutputMode: 'outputFormat' } } } : {}),
      }).then((r) => ({ output: r.output, usage: r.usage, modelo: id })); // output y usage son getters: no sirve el spread
    try {
      return await llamar(this.modeloId);
    } catch (error) {
      if (!this.modeloRespaldoId || this.modeloRespaldoId === this.modeloId) throw error;
      this.logger.warn({ modelo: this.modeloId, error: getErrorMessage(error) }, 'Falló el modelo principal: se usa el de respaldo');
      return llamar(this.modeloRespaldoId);
    }
  }

  async procesarLote(): Promise<{ analizados: number; contactos: number; fallidos: number; omitido?: string }> {
    if (!(await this.configuracion.get('bedrock.habilitado'))) return { analizados: 0, contactos: 0, fallidos: 0, omitido: 'bedrock.habilitado = false' };
    if (!this.disponible) return { analizados: 0, contactos: 0, fallidos: 0, omitido: 'sin credenciales BEDROCK_AWS_*' };
    const lote = await this.configuracion.get('bedrock.lote');
    const docs = await this.prisma.documento.findMany({
      where: { analisisIaEstado: 'PENDIENTE', estado: 'DESCARGADO', extraccionEstado: { in: ['OK', 'SIN_TEXTO'] } },
      // Primero los que parecen Anexo N°1: son los que traen el contacto.
      orderBy: [{ esAnexoIdentificacion: 'desc' }, { descargadoAt: 'desc' }],
      take: lote,
    });
    let contactos = 0;
    let fallidos = 0;
    for (const d of docs) {
      try {
        contactos += await this.analizar(d);
      } catch {
        fallidos++;
      }
    }
    return { analizados: docs.length, contactos, fallidos };
  }

  /** Analiza un documento y guarda sus contactos. Devuelve cuántos contactos encontró. */
  async analizar(doc: Documento): Promise<number> {
    const inicio = Date.now();
    try {
      const contenido = await this.armarContenido(doc);
      if (!contenido) {
        await this.prisma.documento.update({ where: { id: doc.id }, data: { analisisIaEstado: 'NO_APLICA', analizadoIaAt: new Date() } });
        return 0;
      }
      const { output, usage, modelo } = await this.leer(contenido);

      const ms = Date.now() - inicio;
      const entrada = usage.inputTokens ?? 0;
      const salida = usage.outputTokens ?? 0;
      const respaldo = modelo !== this.modeloId;
      const precioEntrada = await this.configuracion.get(respaldo ? 'bedrock.precio_respaldo_entrada_usd_mtok' : 'bedrock.precio_entrada_usd_mtok');
      const precioSalida = await this.configuracion.get(respaldo ? 'bedrock.precio_respaldo_salida_usd_mtok' : 'bedrock.precio_salida_usd_mtok');
      const costo = (entrada * precioEntrada + salida * precioSalida) / 1_000_000;
      const paginas = Array.isArray(contenido) ? contenido.filter((p) => p.type === 'image').length : 0;

      const regs = await this.contactosDe(doc, output, modelo, await this.configuracion.get('bedrock.max_contactos_documento'));
      await this.contactos.guardar(regs);
      await this.prisma.documento.update({
        where: { id: doc.id },
        data: {
          analisisIaEstado: 'OK',
          analisisIa: output as unknown as Prisma.InputJsonValue,
          analisisIaModelo: modelo,
          analisisIaError: null,
          analizadoIaAt: new Date(),
          analisisIaMs: ms,
          analisisIaTokensEntrada: entrada,
          analisisIaTokensSalida: salida,
          analisisIaCostoUsd: costo.toFixed(6),
          analisisIaPaginas: paginas,
          ...(output.es_anexo_identificacion ? { esAnexoIdentificacion: true } : {}),
        },
      });
      this.logger.info({ documento: doc.nombre, proceso: doc.procesoCodigo, modelo, contactos: regs.length, ms, entrada, salida, costoUsd: costo }, 'Documento analizado con Bedrock');
      return regs.length;
    } catch (error) {
      await this.prisma.documento.update({
        where: { id: doc.id },
        data: { analisisIaEstado: 'ERROR', analisisIaError: getErrorMessage(error).slice(0, 1000), analizadoIaAt: new Date(), analisisIaMs: Date.now() - inicio },
      });
      this.logger.warn({ documento: doc.nombre, error: getErrorMessage(error) }, 'Falló el análisis con Bedrock');
      throw error;
    }
  }

  /** Texto fiel + primeras páginas como imagen. null si no hay nada que mandar. */
  private async armarContenido(doc: Documento): Promise<UserContent | null> {
    if (!doc.rutaAlmacen) return null;
    const ext = extension(doc.nombre);
    const archivo = await this.storage.leer(doc.rutaAlmacen);
    const imagenes: Buffer[] = [];
    if (ext === 'pdf' || archivo.subarray(0, 4).toString() === '%PDF') {
      imagenes.push(...(await this.texto.paginasComoImagen(archivo, await this.configuracion.get('bedrock.max_paginas'))));
    } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
      imagenes.push(archivo);
    }
    const textoFiel = (doc.texto ?? '').trim();
    if (!imagenes.length && textoFiel.length < 50) return null;
    return [
      {
        type: 'text',
        text:
          `Documento "${doc.nombre}" (${doc.tipoAnexo ?? 'adjunto'}) del proceso ${doc.procesoCodigo}.` +
          (textoFiel ? `\n\nTEXTO EXTRAÍDO (fiel, copia los valores exactos de aquí):\n${textoFiel.slice(0, MAX_CHARS_TEXTO)}` : '\n\n(Sin texto embebido: es un escaneo, léelo de las imágenes.)'),
      },
      ...imagenes.map((img) => ({ type: 'image' as const, image: img, mediaType: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png' })),
    ];
  }

  /**
   * Pasa la respuesta del modelo a contactos. Si el documento tiene texto y el
   * correo que devolvió el modelo no aparece en él, se baja la confianza: es la
   * forma barata de detectar una transcripción mala o inventada.
   *
   * Dos filtros por lo visto en la muestra de 20 procesos: un documento del
   * proveedor que trae muchas personas es una lista de referencias (clientes,
   * experiencia) y no sus contactos, así que de ahí solo queda el representante
   * legal; y un "comprador" que aparece en un documento del proveedor solo vale
   * con un correo institucional (sin correo, o con Gmail, suele ser el propio
   * proveedor nombrado como solicitante en un informe).
   */
  async contactosDe(doc: Documento, a: AnalisisAnexo, modelo = this.modeloId, maxContactos = 6): Promise<ContactoReg[]> {
    const rutEmpresa = normalizarRut(a.rut_empresa);
    const proceso = await this.prisma.proceso.findUnique({ where: { codigo: doc.procesoCodigo }, select: { compradorRut: true } });
    const textoPlano = (doc.texto ?? '').toLowerCase().replace(/\s+/g, '');
    const hayTexto = textoPlano.length > 200;

    const delOferente = a.contactos.filter((c) => c.rol !== 'comprador');
    const esLista = delOferente.length > maxContactos;
    const validos = a.contactos.filter((c) => {
      if (c.rol === 'comprador') {
        const email = normalizarEmail(c.email);
        return Boolean(email) && !DOMINIOS_PUBLICOS.includes(email!.split('@')[1]);
      }
      if (esLista && c.rol !== 'representante_legal') return false;
      // Sin correo ni teléfono solo sirve el representante legal del propio oferente: los
      // certificados de terceros (laboratorio, distribuidor) traen otros nombres y otro RUT.
      if (!normalizarEmail(c.email) && !normalizarTelefono(c.telefono)) {
        return c.rol === 'representante_legal' && Boolean(doc.proveedorRut) && (normalizarRut(a.rut_empresa) ?? doc.proveedorRut) === doc.proveedorRut;
      }
      return true;
    });

    return validos.map((c) => {
      const esComprador = c.rol === 'comprador';
      const email = normalizarEmail(c.email);
      // Del oferente: el RUT que dice el documento; si no lo dice, el dueño del documento.
      const rut = esComprador ? (proceso?.compradorRut ?? null) : (rutEmpresa ?? doc.proveedorRut);
      // "otro" suele ser el contacto genérico de la empresa (clientes@, ventas@): del oferente, con menos certeza.
      let confianza = esComprador ? 0.8 : c.rol === 'otro' ? 0.7 : 0.9;
      if (!esComprador && doc.proveedorRut && rutEmpresa && rutEmpresa !== doc.proveedorRut) confianza = 0.7;
      if (hayTexto && email && !textoPlano.includes(email)) confianza -= 0.25;
      return {
        rut,
        rol: esComprador ? 'COMPRADOR' : !rut && c.rol === 'otro' ? 'DESCONOCIDO' : 'PROVEEDOR',
        // El modelo a veces pone la razón social como nombre del contacto genérico.
        nombre: c.nombre && c.nombre !== a.razon_social ? c.nombre : null,
        cargo: c.cargo || (c.rol === 'representante_legal' ? 'Representante legal' : null),
        email: c.email || null,
        telefono: c.telefono || null,
        fuente: 'DOCUMENTO_IA',
        procesoCodigo: doc.procesoCodigo,
        documentoId: doc.id,
        evidencia: `Bedrock (${modelo}) sobre "${doc.nombre}"${a.razon_social ? ` · ${a.razon_social}` : ''}`,
        confianza: Math.max(0.1, Number(confianza.toFixed(2))),
      };
    });
  }
}
