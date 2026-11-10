import { parse } from 'csv-parse';
import { createReadStream } from 'fs';
import type { Readable } from 'stream';
import yauzl from 'yauzl';
import type { FilaCsv } from './mapeo';

/** Abre el primer .csv de un zip como stream (sin descomprimir a disco). */
export function abrirCsvDeZip(rutaZip: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    yauzl.open(rutaZip, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip inválido'));
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!/\.csv$/i.test(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => (e || !stream ? reject(e) : resolve(stream)));
      });
      zip.on('end', () => reject(new Error(`El zip ${rutaZip} no trae un .csv`)));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

export interface ResultadoLectura {
  leidas: number;
  conError: number;
}

/**
 * Recorre un CSV de datos abiertos (latin1, ';', comillas dobles) en lotes.
 * Las filas mal formadas se cuentan y se saltan: un registro roto no frena el mes.
 */
export async function recorrerCsv(
  entrada: Readable,
  tamanoLote: number,
  alLote: (filas: FilaCsv[]) => Promise<void>,
): Promise<ResultadoLectura> {
  let conError = 0;
  const parser = entrada.pipe(
    parse({
      delimiter: ';',
      columns: (cabecera: string[]) => cabecera.map((c) => c.trim()),
      encoding: 'latin1',
      bom: true,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
      skip_records_with_error: true,
    }),
  );
  parser.on('skip', () => conError++);
  let lote: FilaCsv[] = [];
  let leidas = 0;
  for await (const fila of parser as AsyncIterable<FilaCsv>) {
    lote.push(fila);
    leidas++;
    if (lote.length >= tamanoLote) {
      await alLote(lote);
      lote = [];
    }
  }
  if (lote.length) await alLote(lote);
  return { leidas, conError };
}

export function abrirCsvLocal(ruta: string): Readable {
  return createReadStream(ruta);
}
