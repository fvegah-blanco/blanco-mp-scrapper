import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { esAnexoIdentificacion } from '../common/anexo1';
import { leerConTope } from '../common/http';
import { normalizarRut } from '../common/rut';
import type { AdjuntoRemoto } from './adjuntos.client';
import { nombreDeDisposition } from './adjuntos.client';
import { SesionWeb } from './sesion-web';

const BASE = 'https://www.mercadopublico.cl';
const PASOS = `${BASE}/Procurement/Modules/RFB/StepsProcessAward/`;

export interface Oferente {
  rut: string;
  proveedor: string;
  estado: string;
  /** Título del botón (Anexos Administrativos/Técnicos/Económicos) → URL ViewBidAttachment. */
  botones: Record<string, string>;
}

interface FilaAnexo {
  archivo: string;
  tipo: string;
  boton: string;
  ocultos: Record<string, string>;
}

/** Error de bloqueo del portal (403): el llamador debe parar la corrida, no reintentar. */
export class PortalBloqueadoError extends Error {}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ocultosDe($: cheerio.CheerioAPI): Record<string, string> {
  const h: Record<string, string> = {};
  $('input[type="hidden"]').each((_, el) => {
    const n = $(el).attr('name');
    if (n) h[n] = $(el).attr('value') ?? '';
  });
  return h;
}

/**
 * Documentos que subió un oferente en una licitación: Ficha → Cuadro de
 * Ofertas → OpeningHeader → SupplySummary (buscador por RUT, porque la tabla
 * de oferentes pagina) → ViewBidAttachment (grilla de a 6, también paginada).
 * Flujo de sii_situacion_tributaria/src/scraper/licitaciones.ts (Seba), sin
 * pasar por el portal de Contratos: aquí ya sabemos qué licitación ganó.
 *
 * El portal banea por IP pasado cierto volumen (HTTP 403): se espera `pausaMs`
 * entre requests y un 403 corta con PortalBloqueadoError.
 */
@Injectable()
export class OfertasClient {
  async oferente(codigo: string, rut: string, pausaMs: number): Promise<{ sesion: SesionWeb; oferente: Oferente } | null> {
    const sesion = new SesionWeb(90_000);
    const html = async (url: string, init?: RequestInit) => {
      await pausa(pausaMs);
      const { res, url: final } = await sesion.pedir(url, init);
      if (res.status === 403) throw new PortalBloqueadoError(`HTTP 403 en ${final}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${final}`);
      return { html: await res.text(), url: final };
    };

    const ficha = await html(`${BASE}/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}`);
    const cuadro = cheerio.load(ficha.html)('a[id*="imgCuadroOferta"]').attr('href') ?? ficha.html.match(/imgCuadroOferta[^>]*?href="([^"]+)"/)?.[1];
    const enc = cuadro?.match(/enc=([^&"]+)/)?.[1];
    if (!enc) return null; // sin cuadro de ofertas publicado

    const cabecera = await html(`${PASOS}OpeningHeader.aspx?enc=${enc}`);
    const resumen = cabecera.html.match(/SupplySummary\.aspx\?enc=[A-Za-z0-9%+/=]+/)?.[0];
    if (!resumen) return null;

    const pagina = await html(`${PASOS}${resumen}`);
    const $ = cheerio.load(pagina.html);
    const accion = ($('form').attr('action') ?? `./${resumen}`).replace(/^\.\//, '');
    const rutConPuntos = rut.replace(/^(\d{1,2})(\d{3})(\d{3})-/, '$1.$2.$3-');
    const buscado = await html(`${PASOS}${accion}`, {
      method: 'POST',
      body: new URLSearchParams({ ...ocultosDe($), txtBuscarPorRut: rutConPuntos, btnBuscarPorRut: 'Buscar' }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const oferente = parsearOferentes(buscado.html).find((o) => normalizarRut(o.rut) === rut);
    return oferente ? { sesion, oferente } : null;
  }

  /**
   * Adjuntos del oferente. Con `soloAnexo1` lista todos (barato, solo HTML) y
   * deja únicamente los que parecen Anexo N°1; si no hay ninguno, devuelve los
   * de "Anexos Administrativos", donde suele venir aunque se llame distinto.
   */
  async adjuntos(sesion: SesionWeb, oferente: Oferente, opciones: { soloAnexo1: boolean; pausaMs: number; maxAdministrativos: number }): Promise<AdjuntoRemoto[]> {
    const todos: Array<FilaAnexo & { url: string; grupo: string }> = [];
    for (const [grupo, urlRel] of Object.entries(oferente.botones)) {
      const url = new URL(urlRel, PASOS).toString();
      for (const fila of await this.listarGrilla(sesion, url, opciones.pausaMs)) todos.push({ ...fila, url, grupo });
    }
    let elegidos = todos;
    if (opciones.soloAnexo1) {
      const anexo1 = todos.filter((f) => esAnexoIdentificacion(f.archivo));
      elegidos = anexo1.length
        ? anexo1
        : todos.filter((f) => /administrativ/i.test(f.grupo) && /\.pdf$/i.test(f.archivo)).slice(0, opciones.maxAdministrativos);
    }
    return elegidos.map((f) => ({
      idExterno: `oferta#${oferente.rut}#${f.grupo}#${f.archivo}`.slice(0, 300),
      nombre: f.archivo,
      tipoAnexo: f.grupo,
      descargar: async (maxBytes) => {
        await pausa(opciones.pausaMs);
        const { res } = await sesion.pedir(f.url, {
          method: 'POST',
          body: new URLSearchParams({ ...f.ocultos, [`${f.boton}.x`]: '10', [`${f.boton}.y`]: '10' }),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: f.url },
        });
        if (res.status === 403) throw new PortalBloqueadoError(`HTTP 403 bajando ${f.archivo}`);
        const mime = res.headers.get('content-type');
        if (!res.ok || mime?.includes('text/html')) {
          await res.body?.cancel();
          throw new Error(`La descarga de ${f.archivo} no devolvió un archivo (HTTP ${res.status})`);
        }
        let nombre = nombreDeDisposition(res.headers.get('content-disposition')) ?? f.archivo;
        // El header llega en UTF-8 leído como latin1 ("NÂº" → "Nº").
        if (/[ÂÃ]/.test(nombre)) nombre = Buffer.from(nombre, 'latin1').toString('utf8');
        return { contenido: await leerConTope(res, maxBytes), mime, nombre };
      },
    }));
  }

  /** Todas las páginas de la grilla de un botón de anexos (sin bajar binarios). */
  private async listarGrilla(sesion: SesionWeb, url: string, pausaMs: number): Promise<FilaAnexo[]> {
    await pausa(pausaMs);
    let { html } = await sesion.html(url);
    let pagina = parsearGrilla(html);
    const filas = [...pagina.filas];
    const total = Math.max(1, ...pagina.paginas);
    for (let n = 2; n <= total; n++) {
      await pausa(pausaMs);
      const { res } = await sesion.pedir(url, {
        method: 'POST',
        body: new URLSearchParams({ ...pagina.ocultos, __EVENTTARGET: 'DWNL$grdId', __EVENTARGUMENT: `Page$${n}` }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (res.status === 403) throw new PortalBloqueadoError(`HTTP 403 paginando ${url}`);
      html = await res.text();
      pagina = parsearGrilla(html);
      filas.push(...pagina.filas);
    }
    return filas;
  }
}

export function parsearOferentes(html: string): Oferente[] {
  const $ = cheerio.load(html);
  const out: Oferente[] = [];
  $('input[type="image"][id$="_GvImgFirma"]').each((_, el) => {
    const tr = $(el).closest('tr');
    const rut = ($(el).attr('onclick') ?? '').match(/ver_declaracion\('([^']+)'/)?.[1];
    if (!rut) return;
    const botones: Record<string, string> = {};
    tr.find('input[type="image"][title]').each((_, b) => {
      const url = ($(b).attr('onclick') ?? '').match(/openPopUp\('([^']+)'/)?.[1];
      if (url?.includes('ViewBidAttachment')) botones[$(b).attr('title') ?? 'Anexos'] = url;
    });
    out.push({
      rut,
      proveedor: tr.find('td').eq(1).text().trim(),
      estado: tr.find('span[id$="_EstadoOferta"]').text().trim(),
      botones,
    });
  });
  return out;
}

export function parsearGrilla(html: string): { filas: FilaAnexo[]; ocultos: Record<string, string>; paginas: number[] } {
  const $ = cheerio.load(html);
  const ocultos = ocultosDe($);
  const filas: FilaAnexo[] = [];
  $('#DWNL_grdId tr').each((_, tr) => {
    const archivo = $(tr).find('span[id$="_File"]').text().trim();
    const boton = $(tr).find('input[id$="_search"]').attr('name');
    if (archivo && boton) filas.push({ archivo, tipo: $(tr).find('span[id$="_Type"]').text().trim(), boton, ocultos });
  });
  // Paginación: href="javascript:__doPostBack('DWNL$grdId','Page$N')" (comillas HTML-encoded:
  // se lee con cheerio, no con regex sobre el HTML crudo).
  const paginas: number[] = [];
  $('a[href*="Page$"]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const m = href.match(/Page\$(\d+)/);
    if (m && href.includes('DWNL$grdId')) paginas.push(Number(m[1]));
  });
  return { filas, ocultos, paginas: [...new Set(paginas)] };
}
