import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { dirname, join } from 'path';
import yauzl from 'yauzl';
import { getErrorMessage } from '../common/errores';
import { OcrService } from './ocr.service';

export interface TextoExtraido {
  texto: string;
  metodo: 'TEXTO' | 'OCR' | 'NINGUNO';
  paginas?: number;
}

/** Un PDF con menos de esto por página se trata como escaneado. */
const MIN_CHARS_POR_PAGINA = 80;
const MAX_ARCHIVOS_ZIP = 40;
const MAX_BYTES_ENTRADA_ZIP = 30 * 1024 * 1024;

export function extension(nombre: string): string {
  const m = nombre.toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return m ? m[1] : '';
}

/**
 * Texto de un adjunto: PDF (capa de texto y, si es escaneado, OCR página a
 * página), Word .docx, Excel .xlsx, imágenes (OCR), texto plano y .zip (se
 * recorre por dentro). .doc/.xls/.rar quedan sin texto.
 */
@Injectable()
export class TextoService {
  constructor(
    @InjectPinoLogger(TextoService.name) private readonly logger: PinoLogger,
    private readonly ocr: OcrService,
  ) {}

  async extraer(
    contenido: Buffer,
    nombre: string,
    opciones: { ocrMaxPaginas: number; maxChars: number },
    profundidad = 0,
  ): Promise<TextoExtraido> {
    const ext = extension(nombre);
    try {
      let r: TextoExtraido;
      if (ext === 'pdf' || contenido.subarray(0, 4).toString() === '%PDF') r = await this.pdf(contenido, opciones.ocrMaxPaginas);
      else if (ext === 'docx') r = { texto: (await mammoth.extractRawText({ buffer: contenido })).value, metodo: 'TEXTO' };
      else if (ext === 'xlsx') r = { texto: await this.xlsx(contenido), metodo: 'TEXTO' };
      else if (['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'gif', 'webp'].includes(ext)) r = { texto: await this.ocr.reconocer(contenido), metodo: 'OCR' };
      else if (['txt', 'csv', 'xml', 'html', 'htm', 'json'].includes(ext)) r = { texto: contenido.toString('utf8'), metodo: 'TEXTO' };
      else if (ext === 'zip' && profundidad === 0) r = await this.zip(contenido, opciones);
      else r = { texto: '', metodo: 'NINGUNO' };
      return { ...r, texto: limpiar(r.texto).slice(0, opciones.maxChars) };
    } catch (error) {
      this.logger.warn({ nombre, error: getErrorMessage(error) }, 'No se pudo extraer texto');
      throw error;
    }
  }

  /** Primeras `max` páginas de un PDF como PNG (para OCR o para mandarlas a un modelo con visión). */
  async paginasComoImagen(contenido: Buffer, max: number, escala = 2): Promise<Buffer[]> {
    const doc = await abrirPdf(contenido);
    try {
      const out: Buffer[] = [];
      for (let n = 1; n <= Math.min(doc.numPages, max); n++) out.push(await rasterizar(doc, n, escala));
      return out;
    } finally {
      await doc.loadingTask.destroy();
    }
  }

  private async pdf(contenido: Buffer, ocrMaxPaginas: number): Promise<TextoExtraido> {
    const doc = await abrirPdf(contenido);
    try {
      const paginas: string[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const pagina = await doc.getPage(n);
        const contenidoTexto = await pagina.getTextContent();
        paginas.push(contenidoTexto.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join(''));
      }
      const total = paginas.reduce((s, p) => s + p.trim().length, 0);
      if (total >= MIN_CHARS_POR_PAGINA * Math.min(doc.numPages, 3)) {
        return { texto: paginas.join('\n\n'), metodo: 'TEXTO', paginas: doc.numPages };
      }
      // Escaneado: se rasteriza y se pasa por OCR (las primeras N páginas).
      const partes: string[] = [];
      for (let n = 1; n <= Math.min(doc.numPages, ocrMaxPaginas); n++) {
        partes.push(await this.ocr.reconocer(await rasterizar(doc, n, 2)));
      }
      return { texto: partes.join('\n\n'), metodo: 'OCR', paginas: doc.numPages };
    } finally {
      await doc.loadingTask.destroy();
    }
  }

  private async xlsx(contenido: Buffer): Promise<string> {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(contenido as unknown as ArrayBuffer);
    const lineas: string[] = [];
    libro.eachSheet((hoja) => {
      lineas.push(`[Hoja: ${hoja.name}]`);
      hoja.eachRow((fila) => {
        const celdas = (fila.values as unknown[]).slice(1).map((v) => celdaTexto(v)).filter(Boolean);
        if (celdas.length) lineas.push(celdas.join(' | '));
      });
    });
    return lineas.join('\n');
  }

  private async zip(contenido: Buffer, opciones: { ocrMaxPaginas: number; maxChars: number }): Promise<TextoExtraido> {
    const entradas = await leerZip(contenido);
    const partes: string[] = [];
    let uso: TextoExtraido['metodo'] = 'NINGUNO';
    for (const e of entradas) {
      const r = await this.extraer(e.contenido, e.nombre, opciones, 1).catch(() => null);
      if (!r || !r.texto) continue;
      partes.push(`=== ${e.nombre} ===\n${r.texto}`);
      if (uso !== 'OCR') uso = r.metodo;
    }
    return { texto: partes.join('\n\n'), metodo: partes.length ? uso : 'NINGUNO' };
  }
}

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsCargado: Promise<Pdfjs> | null = null;

/**
 * pdf.js es ESM puro: se importa con un import() real (TypeScript en CommonJS
 * lo convertiría en require). Se usa el build legacy, el que soporta Node.
 */
function cargarPdfjs(): Promise<Pdfjs> {
  const importar = new Function('ruta', 'return import(ruta)') as (ruta: string) => Promise<Pdfjs>;
  pdfjsCargado ??= importar(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  return pdfjsCargado;
}

type DocumentoPdf = Awaited<ReturnType<Pdfjs['getDocument']>['promise']>;

async function abrirPdf(contenido: Buffer): Promise<DocumentoPdf> {
  const pdfjs = await cargarPdfjs();
  const base = dirname(require.resolve('pdfjs-dist/package.json'));
  // wasmUrl: los escaneados suelen venir en JBIG2/JPX, que pdf.js decodifica con wasm.
  return pdfjs.getDocument({
    data: new Uint8Array(contenido),
    wasmUrl: join(base, 'wasm') + '/',
    standardFontDataUrl: join(base, 'standard_fonts') + '/',
    cMapUrl: join(base, 'cmaps') + '/',
    disableFontFace: true,
  }).promise;
}

async function rasterizar(doc: DocumentoPdf, n: number, escala: number): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const pagina = await doc.getPage(n);
  const vista = pagina.getViewport({ scale: escala });
  const lienzo = createCanvas(Math.ceil(vista.width), Math.ceil(vista.height));
  await pagina.render({ canvas: lienzo as unknown as HTMLCanvasElement, canvasContext: lienzo.getContext('2d') as unknown as CanvasRenderingContext2D, viewport: vista }).promise;
  return lienzo.toBuffer('image/png');
}

function celdaTexto(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if (o.text) return String(o.text);
    if (o.result !== undefined) return String(o.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v).trim();
}

function limpiar(t: string): string {
  return t.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function leerZip(contenido: Buffer): Promise<Array<{ nombre: string; contenido: Buffer }>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(contenido, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip inválido'));
      const out: Array<{ nombre: string; contenido: Buffer }> = [];
      zip.on('entry', (entry: yauzl.Entry) => {
        if (/\/$/.test(entry.fileName) || entry.uncompressedSize > MAX_BYTES_ENTRADA_ZIP || out.length >= MAX_ARCHIVOS_ZIP) {
          return zip.readEntry();
        }
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return zip.readEntry();
          const trozos: Buffer[] = [];
          stream.on('data', (c: Buffer) => trozos.push(c));
          stream.on('end', () => {
            out.push({ nombre: entry.fileName, contenido: Buffer.concat(trozos) });
            zip.readEntry();
          });
          stream.on('error', () => zip.readEntry());
        });
      });
      zip.on('end', () => resolve(out));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}
