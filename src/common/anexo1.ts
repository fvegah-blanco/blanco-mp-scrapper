/**
 * ¿Es el "ANEXO N°1 / Formulario de identificación del oferente"? Ahí está el
 * contacto del vendedor (representante legal y contacto comercial). El nombre
 * del archivo varía libremente, así que también se mira el título del texto.
 * Tomado de sii_situacion_tributaria (extractor/contactos-pdf.ts, de Seba).
 */

// "ANEXO N°1" y variantes: Anexo Nº 1, ANEXO N. 1, anexo_n1, Anexo-01... (sin calzar ANEXO N°10)
const ANEXO1_RE = /ANEXO\s*[_-]?\s*(?:N\s*[°ºO.Â]*\s*)?[_-]?0*1(?![0-9])/i;
const TITULO_FORMULARIO_RE =
  /FORMULARIO[\s_-]+(?:DEL?[\s_-]+)?OFERENTE|IDENTIFICACI[OÓ]N[\s_-]+DEL?[\s_-]+(?:OFERENTE|PROPONENTE|PROVEEDOR)|DATOS[\s_-]+DEL?[\s_-]+(?:OFERENTE|PROPONENTE)/i;

export function esAnexoIdentificacion(nombreArchivo: string, texto = ''): boolean {
  const inicio = texto.slice(0, 400);
  return [nombreArchivo, inicio].some((t) => ANEXO1_RE.test(t) || TITULO_FORMULARIO_RE.test(t));
}
