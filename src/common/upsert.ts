import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export interface DefinicionUpsert {
  tabla: string;
  /** Columnas en el orden de cada fila. */
  columnas: string[];
  /** Columnas del ON CONFLICT. */
  conflicto: string[];
  /**
   * SET del DO UPDATE por columna; por defecto `col = EXCLUDED.col`. Se puede
   * pasar SQL propio (p.ej. COALESCE para no pisar un dato con un vacío).
   */
  actualizar?: Record<string, string>;
  /** Columnas que no se tocan al actualizar. */
  noActualizar?: string[];
}

/**
 * INSERT ... ON CONFLICT DO UPDATE en lote. Prisma no tiene upsert masivo y el
 * createMany no actualiza; esto deja una sola sentencia por lote. Las filas
 * deben venir sin duplicados de la clave de conflicto (Postgres no deja tocar
 * la misma fila dos veces en una sentencia): usar `deduplicar`.
 */
export async function upsertLote(
  prisma: PrismaService,
  def: DefinicionUpsert,
  filas: unknown[][],
): Promise<number> {
  if (filas.length === 0) return 0;
  const cols = def.columnas.map((c) => `"${c}"`).join(', ');
  const noTocar = new Set([...def.conflicto, ...(def.noActualizar ?? [])]);
  const sets = def.columnas
    .filter((c) => !noTocar.has(c))
    .map((c) => `"${c}" = ${def.actualizar?.[c] ?? `EXCLUDED."${c}"`}`);
  sets.push(...Object.entries(def.actualizar ?? {})
    .filter(([c]) => !def.columnas.includes(c))
    .map(([c, expr]) => `"${c}" = ${expr}`));
  const valores = Prisma.join(filas.map((f) => Prisma.sql`(${Prisma.join(f)})`));
  const sql = Prisma.sql`INSERT INTO ${Prisma.raw(`"${def.tabla}"`)} (${Prisma.raw(cols)})
    VALUES ${valores}
    ON CONFLICT (${Prisma.raw(def.conflicto.map((c) => `"${c}"`).join(', '))})
    ${Prisma.raw(sets.length ? `DO UPDATE SET ${sets.join(', ')}` : 'DO NOTHING')}`;
  return prisma.$executeRaw(sql);
}

/** Deja una fila por clave; si se repite, `combinar` decide (por defecto gana la última). */
export function deduplicar<T>(
  filas: T[],
  clave: (f: T) => string,
  combinar: (anterior: T, nueva: T) => T = (_a, b) => b,
): T[] {
  const mapa = new Map<string, T>();
  for (const f of filas) {
    const k = clave(f);
    const previa = mapa.get(k);
    mapa.set(k, previa ? combinar(previa, f) : f);
  }
  return [...mapa.values()];
}
