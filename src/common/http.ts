import { getErrorMessage } from './errores';

export const UA_NAVEGADOR =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export interface OpcionesFetch extends RequestInit {
  /** Reintentos ante 429/5xx/timeout (por defecto 3). */
  reintentos?: number;
  timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    cuerpo: string,
  ) {
    super(`HTTP ${status} en ${url}: ${cuerpo.slice(0, 200)}`);
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch con User-Agent de navegador, timeout y reintentos con backoff. Las APIs
 * de Mercado Público cortan a los 29 s ("Endpoint request timed out") y a veces
 * responden 5xx en ráfagas; un 4xx distinto de 429 no se reintenta.
 */
export async function fetchMp(url: string, opciones: OpcionesFetch = {}): Promise<Response> {
  const { reintentos = 3, timeoutMs = 45_000, headers, ...resto } = opciones;
  let ultimoError: unknown;
  for (let intento = 0; intento <= reintentos; intento++) {
    try {
      const res = await fetch(url, {
        ...resto,
        headers: { 'User-Agent': UA_NAVEGADOR, ...(headers as Record<string, string>) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        throw new HttpError(res.status, url, await res.text().catch(() => ''));
      }
      if (!res.ok) {
        // 4xx definitivo: no se reintenta.
        const cuerpo = await res.text().catch(() => '');
        const err = new HttpError(res.status, url, cuerpo);
        (err as HttpError & { definitivo: boolean }).definitivo = true;
        throw err;
      }
      return res;
    } catch (error) {
      ultimoError = error;
      if ((error as { definitivo?: boolean }).definitivo) throw error;
      if (intento < reintentos) await esperar(1_000 * 2 ** intento + Math.random() * 500);
    }
  }
  throw new Error(`Falló ${url} tras ${reintentos + 1} intentos: ${getErrorMessage(ultimoError)}`);
}

/** JSON del buscador: la API responde 200 con {"message": "Endpoint request timed out"} al cortar. */
export async function fetchJsonMp<T>(url: string, opciones: OpcionesFetch = {}): Promise<T> {
  const { reintentos = 3, ...resto } = opciones;
  let ultimo: unknown;
  for (let intento = 0; intento <= reintentos; intento++) {
    const res = await fetchMp(url, { ...resto, reintentos: Math.min(1, reintentos) });
    const textoCuerpo = await res.text();
    // La ficha de un código que no existe responde 200 con cuerpo vacío.
    if (!textoCuerpo.trim()) return {} as T;
    const cuerpo = JSON.parse(textoCuerpo) as T & { message?: string; success?: string };
    if (cuerpo && typeof cuerpo === 'object' && 'message' in cuerpo && !('payload' in cuerpo)) {
      ultimo = cuerpo.message;
      if (intento < reintentos) await esperar(2_000 * 2 ** intento);
      continue;
    }
    return cuerpo;
  }
  throw new Error(`Buscador sin respuesta útil en ${url}: ${String(ultimo)}`);
}

/** Corre `fn` sobre `items` con a lo más `concurrencia` en paralelo. */
export async function enParalelo<T, R>(
  items: T[],
  concurrencia: number,
  fn: (item: T, indice: number) => Promise<R>,
): Promise<R[]> {
  const resultados: R[] = new Array(items.length);
  let siguiente = 0;
  const trabajadores = Array.from({ length: Math.max(1, Math.min(concurrencia, items.length)) }, async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      resultados[i] = await fn(items[i], i);
    }
  });
  await Promise.all(trabajadores);
  return resultados;
}
