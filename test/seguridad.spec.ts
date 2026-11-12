import type { ExecutionContext } from '@nestjs/common';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { AdminKeyGuard, exigirLlaveEnProduccion } from '../src/common/admin-key.guard';
import { CodigoMpPipe } from '../src/common/codigo-mp.pipe';
import { ArchivoMuyGrandeError, leerConTope } from '../src/common/http';
import { StorageService } from '../src/documentos/storage.service';

const contexto = (llave?: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ header: (n: string) => (n === 'x-admin-key' ? llave : undefined) }) }) }) as unknown as ExecutionContext;

describe('AdminKeyGuard', () => {
  const previo = { ...process.env };
  afterEach(() => {
    process.env = { ...previo };
  });

  it('sin llave configurada deja pasar solo fuera de producción', () => {
    delete process.env.ADMIN_API_KEY;
    process.env.NODE_ENV = 'development';
    expect(new AdminKeyGuard().canActivate(contexto())).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(() => new AdminKeyGuard().canActivate(contexto())).toThrow('Falta configurar ADMIN_API_KEY');
    expect(() => exigirLlaveEnProduccion()).toThrow('ADMIN_API_KEY es obligatoria');
  });

  it('con llave exige el header exacto', () => {
    process.env.ADMIN_API_KEY = 'llave-de-prueba';
    const guard = new AdminKeyGuard();
    expect(guard.canActivate(contexto('llave-de-prueba'))).toBe(true);
    expect(() => guard.canActivate(contexto('llave-de-prueb'))).toThrow('x-admin-key inválida');
    expect(() => guard.canActivate(contexto())).toThrow('x-admin-key inválida');
  });
});

describe('CodigoMpPipe', () => {
  const pipe = new CodigoMpPipe();
  it('normaliza códigos reales', () => {
    expect(pipe.transform(' 799512-11-le26 ')).toBe('799512-11-LE26');
    expect(pipe.transform('1196-63-COT26')).toBe('1196-63-COT26');
    expect(pipe.transform('3885-29-L126')).toBe('3885-29-L126');
  });
  it('rechaza lo que no es un código', () => {
    for (const malo of ['../../etc/passwd', '1196-63-COT26/..', '', 'abc', "1-1-AG26' OR 1=1"]) {
      expect(() => pipe.transform(malo)).toThrow('Código de Mercado Público inválido');
    }
  });
});

describe('leerConTope', () => {
  it('devuelve el cuerpo si cabe', async () => {
    expect((await leerConTope(new Response('hola'), 10)).toString()).toBe('hola');
  });
  it('corta por content-length o por bytes leídos', async () => {
    await expect(leerConTope(new Response('x'.repeat(50), { headers: { 'content-length': '50' } }), 10)).rejects.toBeInstanceOf(ArchivoMuyGrandeError);
    const flujo = new ReadableStream({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(8));
        c.close();
      },
    });
    await expect(leerConTope(new Response(flujo), 20)).rejects.toBeInstanceOf(ArchivoMuyGrandeError);
  });
});

describe('StorageService en disco', () => {
  it('guarda con ruta relativa y no sale de STORAGE_DIR', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mp-storage-'));
    process.env.STORAGE_DIR = dir;
    delete process.env.S3_BUCKET;
    try {
      const storage = new StorageService();
      const ruta = await storage.guardar('procesos/1-1-LE26/a.txt', Buffer.from('ok'), null);
      expect(ruta).toBe('local://procesos/1-1-LE26/a.txt');
      expect((await storage.leer(ruta)).toString()).toBe('ok');
      await expect(storage.guardar('../fuera.txt', Buffer.from('x'), null)).rejects.toThrow('Clave fuera del almacenamiento');
      await expect(storage.leer('local://../../etc/passwd')).rejects.toThrow('Clave fuera del almacenamiento');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
