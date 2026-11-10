/**
 * Conversores para los CSV de datos abiertos: vienen en latin1, con ';' y con
 * números en formato chileno ("118588323,07") y "NA" como vacío.
 */

const VACIOS = new Set(['', 'NA', 'N/A', 'NULL', 'null', '-']);

export function texto(valor: string | null | undefined, max = 4000): string | null {
  if (valor === null || valor === undefined) return null;
  const t = valor.trim();
  if (VACIOS.has(t)) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/** "118588323,07" → "118588323.07" (string para Decimal). */
export function decimal(valor: string | null | undefined): string | null {
  const t = texto(valor);
  if (t === null) return null;
  // Si trae punto y coma a la vez, el punto es separador de miles.
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return /^-?\d+(\.\d+)?$/.test(normal) ? normal : null;
}

export function entero(valor: string | null | undefined): number | null {
  const d = decimal(valor);
  if (d === null) return null;
  const n = Math.trunc(Number(d));
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Fechas de los CSV ("2026-11-03", "2026-11-03 10:15:00") y del buscador
 * ("10-11-2026 13:19:59", "2026-11-09 13:08"). Se interpretan en hora de Chile.
 */
export function fecha(valor: string | null | undefined): Date | null {
  const t = texto(valor);
  if (t === null) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  let anio: string, mes: string, dia: string, h = '00', mi = '00', s = '00';
  if (m) {
    [, anio, mes, dia] = m;
    h = m[4] ?? h; mi = m[5] ?? mi; s = m[6] ?? s;
  } else {
    m = t.match(/^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    [, dia, mes, anio] = m;
    h = m[4] ?? h; mi = m[5] ?? mi; s = m[6] ?? s;
  }
  if (Number(anio) < 1990) return null;
  // Chile continental: UTC-3 en verano, UTC-4 en invierno. Se usa -03:00/-04:00
  // según el offset real de America/Santiago en esa fecha.
  const base = new Date(`${anio}-${mes}-${dia}T${h}:${mi}:${s}Z`);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() - offsetSantiagoMs(base));
}

function offsetSantiagoMs(fechaUtc: Date): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(fechaUtc);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  const local = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return local - fechaUtc.getTime();
}

/** "Si"/"No" del CSV. */
export function siNo(valor: string | null | undefined): boolean {
  return (valor ?? '').trim().toLowerCase().startsWith('s');
}

/** Fecha local de Chile como YYYY-MM-DD. */
export function hoyChile(desplazamientoDias = 0, ahora = new Date()): string {
  const d = new Date(ahora.getTime() + desplazamientoDias * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}
