import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';

/**
 * Dónde quedan los adjuntos: S3 si hay S3_BUCKET (como el bucket de storage
 * del back office), si no, disco local en STORAGE_DIR.
 */
@Injectable()
export class StorageService {
  private readonly bucket = process.env.S3_BUCKET || null;
  private readonly prefijo = process.env.S3_PREFIX ?? 'mp-scrapper';
  private readonly dir = resolve(process.env.STORAGE_DIR ?? './storage');
  private s3: S3Client | null = null;

  private cliente(): S3Client {
    this.s3 ??= new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
    return this.s3;
  }

  /**
   * Guarda y devuelve la ruta lógica: s3://bucket/key, o local://clave relativa a STORAGE_DIR
   * (así la misma base sirve en el host y en el contenedor).
   */
  async guardar(clave: string, contenido: Buffer, mime: string | null): Promise<string> {
    if (this.bucket) {
      const key = `${this.prefijo}/${clave}`;
      await this.cliente().send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: contenido, ContentType: mime ?? undefined }));
      return `s3://${this.bucket}/${key}`;
    }
    const ruta = this.rutaLocal(clave);
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, contenido);
    return `local://${clave}`;
  }

  /** Ruta en disco de una clave, siempre dentro de STORAGE_DIR. */
  private rutaLocal(clave: string): string {
    const ruta = resolve(this.dir, clave);
    if (!ruta.startsWith(this.dir + sep)) throw new Error(`Clave fuera del almacenamiento: ${clave.slice(0, 80)}`);
    return ruta;
  }

  async leer(ruta: string): Promise<Buffer> {
    if (ruta.startsWith('s3://')) {
      const [, , bucket, ...resto] = ruta.split('/');
      const r = await this.cliente().send(new GetObjectCommand({ Bucket: bucket, Key: resto.join('/') }));
      return Buffer.from(await r.Body!.transformToByteArray());
    }
    if (ruta.startsWith('local://')) return readFile(this.rutaLocal(ruta.slice('local://'.length)));
    // Rutas antiguas: absolutas con file://.
    return readFile(ruta.replace(/^file:\/\//, ''));
  }
}
