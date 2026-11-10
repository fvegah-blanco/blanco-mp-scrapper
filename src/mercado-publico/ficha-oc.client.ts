import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { fetchMp } from '../common/http';
import { normalizarRut } from '../common/rut';
import { type ContactoFicha, contactosDeFichaOc, imagenesOfuscadas, stringsDelViewState } from './viewstate';

const FICHA = 'https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=';
const RE_CODIGO_PROCESO = /\b\d{1,7}-\d{1,5}-(?:L1|LE|LP|LQ|LR|LS|O1|E2|CO|B2|H2|I2|O2|COT)\d{2}\b/g;

export interface FichaOc {
  codigo: string;
  estado: string | null;
  compradorRut: string | null;
  proveedorRut: string | null;
  proveedorRazonSocial: string | null;
  /** Licitación (o compra ágil) de origen si la ficha la menciona. */
  procesoCodigo: string | null;
  plazoPago: string | null;
  comprador: ContactoFicha | null;
  proveedor: ContactoFicha | null;
  /** Imágenes con datos ofuscados (se pasan por OCR si el ViewState no trae el dato). */
  imagenes: string[];
}

/**
 * Ficha pública de una OC (WebForms). Se lee sin navegador: el HTML trae los
 * datos generales y el ViewState el contacto del comprador.
 */
@Injectable()
export class FichaOcClient {
  async leer(codigo: string): Promise<FichaOc> {
    const res = await fetchMp(FICHA + encodeURIComponent(codigo), { reintentos: 2 });
    return parsearFichaOc(codigo, await res.text());
  }

  /** Descarga una imagen ofuscada (JPEG seguido de basura HTML: se corta en el EOI). */
  async imagen(url: string): Promise<Buffer> {
    const res = await fetchMp(url, { reintentos: 1, headers: { Referer: FICHA } });
    const b = Buffer.from(await res.arrayBuffer());
    const fin = b.lastIndexOf(Buffer.from([0xff, 0xd9]));
    return fin > 0 ? b.subarray(0, fin + 2) : b;
  }
}

export function parsearFichaOc(codigo: string, html: string): FichaOc {
  const $ = cheerio.load(html);
  const val = (id: string) => $(`#${id}`).first().text().trim() || null;
  const viewState = $('#__VIEWSTATE').attr('value') ?? '';
  const strings = viewState ? stringsDelViewState(viewState) : [];
  const { comprador, proveedor } = contactosDeFichaOc(strings);

  // El código de la licitación aparece en el nombre, las notas o el ViewState.
  const textoCompleto = `${$('body').text()} ${strings.join(' ')}`;
  const candidatos = [...new Set(textoCompleto.match(RE_CODIGO_PROCESO) ?? [])];

  return {
    codigo,
    estado: val('lblStatusPOValue'),
    compradorRut: normalizarRut(val('lblBuyerTaxIDValue') ?? val('lblIDValue')),
    proveedorRut: normalizarRut(val('lblRutValueP')),
    proveedorRazonSocial: val('lblSocialReasonValueP'),
    procesoCodigo: candidatos[0]?.toUpperCase() ?? null,
    plazoPago: val('lblPaymentMethodValue'),
    comprador,
    proveedor,
    imagenes: imagenesOfuscadas(strings),
  };
}
