import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { mkdir } from 'fs/promises';
import { resolve } from 'path';
import { createWorker, type Worker } from 'tesseract.js';

/**
 * OCR con Tesseract (tesseract.js, sin binarios del sistema). Un solo worker
 * por proceso, creado al primer uso; los modelos de idioma se descargan la
 * primera vez a TMP_DIR/tessdata.
 */
@Injectable()
export class OcrService implements OnModuleDestroy {
  private worker: Promise<Worker> | null = null;
  private cola: Promise<unknown> = Promise.resolve();

  private obtenerWorker(): Promise<Worker> {
    if (!this.worker) {
      this.worker = (async () => {
        const cachePath = resolve(process.env.TMP_DIR ?? './tmp', 'tessdata');
        await mkdir(cachePath, { recursive: true });
        return createWorker(process.env.OCR_LANGS ?? 'spa+eng', 1, { cachePath });
      })();
      this.worker.catch(() => {
        this.worker = null;
      });
    }
    return this.worker;
  }

  /** Texto de una imagen (PNG/JPEG/TIFF). Las llamadas se serializan: el worker es uno. */
  async reconocer(imagen: Buffer): Promise<string> {
    const tarea = this.cola.then(async () => {
      const w = await this.obtenerWorker();
      const { data } = await w.recognize(imagen);
      return data.text ?? '';
    });
    this.cola = tarea.catch(() => undefined);
    return tarea;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await (await this.worker).terminate().catch(() => undefined);
  }
}
