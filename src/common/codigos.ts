const RE_COT = /\b(\d{1,8}-\d{1,6}-COT\d{2})\b/i;

/**
 * Código de la compra ágil escrito en el nombre u observaciones de una OC. MP
 * lo agrega solo ("Orden de Compra generada por invitación a compra ágil:
 * 3485-1129-COT26") y muchos compradores lo copian a mano ("... / 2098-743-COT26").
 * Pasa en ~80% de las OC AG; el resto se busca en el buscador.
 */
export function codigoCompraAgilEnTexto(...textos: Array<string | null | undefined>): string | null {
  for (const t of textos) {
    const m = t?.match(RE_COT);
    if (m) return m[1].toUpperCase();
  }
  return null;
}
