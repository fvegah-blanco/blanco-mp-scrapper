import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { fetchJsonMp, fetchMp } from '../common/http';
import { SesionWeb } from './sesion-web';

const ADJUNTOS_CA = 'https://adjunto.mercadopublico.cl/adjunto-compra-agil/v1/adjuntos-compra-agil';
const FICHA_LIC = 'https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=';

export interface AdjuntoRemoto {
  /** GUID (compra ágil) o "<n° de página de anexos>#<fila>" (licitación). */
  idExterno: string;
  nombre: string;
  tipoAnexo: string | null;
  /** Baja el archivo. Se llama dentro de la misma sesión en que se listó. */
  descargar: () => Promise<ArchivoDescargado>;
}

export interface ArchivoDescargado {
  contenido: Buffer;
  mime: string | null;
  nombre: string | null;
}

/** Decodifica "=?utf-8?B?...?=" / "=?utf-8?Q?...?=" (RFC 2047), como manda el servidor de adjuntos de compra ágil. */
export function decodificarRfc2047(valor: string): string {
  return valor.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_t, charset: string, modo: string, datos: string) => {
    const bytes = modo.toUpperCase() === 'B'
      ? Buffer.from(datos, 'base64')
      : Buffer.from(datos.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    return new TextDecoder(charset.toLowerCase() === 'utf-8' ? 'utf-8' : 'latin1').decode(bytes);
  });
}

export function nombreDeDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";\r\n]+)"?/i);
  if (!m) return null;
  let nombre = m[1];
  try {
    nombre = decodeURIComponent(nombre);
  } catch {
    // ya venía sin codificar
  }
  return decodificarRfc2047(nombre);
}

/**
 * Adjuntos de un proceso, sin navegador:
 *  - Compra ágil: API `adjunto.mercadopublico.cl` (lista GUID → descarga) con la
 *    user_key pública del buscador (mismo flujo que licitamatch/ca_adjuntos.py).
 *  - Licitación: ficha → páginas `VerAntecedentes.aspx?enc=` → postback del
 *    botón "Ver Anexo" de cada fila con su __VIEWSTATE (lo que en licitamatch
 *    hacía Playwright).
 */
@Injectable()
export class AdjuntosClient {
  private get headersCa() {
    return { user_key: process.env.MP_ADJUNTOS_USER_KEY ?? '41186b85826e80d1a0d445a6ce67d1a3' };
  }

  async listar(codigo: string): Promise<AdjuntoRemoto[]> {
    return /-COT\d{2}$/i.test(codigo) ? this.listarCompraAgil(codigo) : this.listarLicitacion(codigo);
  }

  async listarCompraAgil(codigo: string): Promise<AdjuntoRemoto[]> {
    const r = await fetchJsonMp<{ payload?: { files?: Array<{ id: string; nombreArchivo?: string; nombre?: string }> } }>(
      `${ADJUNTOS_CA}/listar/${encodeURIComponent(codigo.toUpperCase())}`,
      { headers: this.headersCa },
    );
    return (r.payload?.files ?? [])
      .filter((f) => f.id)
      .map((f) => ({
        idExterno: f.id,
        nombre: f.nombreArchivo ?? f.nombre ?? 'documento',
        tipoAnexo: 'Adjunto compra ágil',
        descargar: async () => {
          const res = await fetchMp(`${ADJUNTOS_CA}/descargar/${f.id}`, { headers: this.headersCa, timeoutMs: 120_000 });
          return {
            contenido: Buffer.from(await res.arrayBuffer()),
            mime: res.headers.get('content-type'),
            nombre: nombreDeDisposition(res.headers.get('content-disposition')),
          };
        },
      }));
  }

  async listarLicitacion(codigo: string): Promise<AdjuntoRemoto[]> {
    const sesion = new SesionWeb(120_000);
    const { html: ficha, url: urlFicha } = await sesion.html(FICHA_LIC + encodeURIComponent(codigo));
    const $f = cheerio.load(ficha);
    const paginas = new Set<string>();
    $f('a[href*="VerAntecedentes.aspx"], input[onclick*="VerAntecedentes.aspx"]').each((_, el) => {
      const crudo = $f(el).attr('href') ?? $f(el).attr('onclick') ?? '';
      const m = crudo.match(/[^'"]*VerAntecedentes\.aspx\?enc=[^'"&]+/);
      if (m) paginas.add(new URL(m[0].replace(/&amp;/g, '&'), urlFicha).toString());
    });
    // El HTML de MP a veces viene mal formado: respaldo por regex.
    for (const m of ficha.matchAll(/(?:\.\.\/)+Attachment\/VerAntecedentes\.aspx\?enc=[^'"&\s]+/g)) {
      paginas.add(new URL(m[0], urlFicha).toString());
    }

    const adjuntos: AdjuntoRemoto[] = [];
    let nPagina = 0;
    for (const urlPagina of paginas) {
      nPagina++;
      const { html } = await sesion.html(urlPagina);
      const $ = cheerio.load(html);
      const viewState = $('#__VIEWSTATE').attr('value') ?? '';
      const generador = $('#__VIEWSTATEGENERATOR').attr('value') ?? '';
      const validacion = $('#__EVENTVALIDATION').attr('value');
      $('input[type="image"][name*="grdIbtnView"]').each((fila, el) => {
        const boton = $(el).attr('name')!;
        const celdas = $(el).closest('tr').find('td').map((_, td) => $(td).text().trim()).get().filter(Boolean);
        const nombre = celdas[0] ?? `anexo-${nPagina}-${fila + 1}`;
        const pagina = nPagina;
        adjuntos.push({
          idExterno: `${pagina}#${fila + 1}#${nombre}`.slice(0, 300),
          nombre,
          tipoAnexo: celdas[2] ?? celdas[1] ?? null,
          descargar: async () => {
            const cuerpo = new URLSearchParams({
              __VIEWSTATE: viewState,
              __VIEWSTATEGENERATOR: generador,
              [`${boton}.x`]: '5',
              [`${boton}.y`]: '5',
            });
            if (validacion) cuerpo.set('__EVENTVALIDATION', validacion);
            const { res } = await sesion.pedir(urlPagina, {
              method: 'POST',
              body: cuerpo,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: urlPagina },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status} al bajar ${nombre}`);
            const mime = res.headers.get('content-type');
            if (mime?.includes('text/html')) {
              await res.body?.cancel();
              throw new Error(`La descarga de ${nombre} devolvió HTML (sesión o postback inválido)`);
            }
            return {
              contenido: Buffer.from(await res.arrayBuffer()),
              mime,
              nombre: nombreDeDisposition(res.headers.get('content-disposition')),
            };
          },
        });
      });
    }
    return adjuntos;
  }
}
