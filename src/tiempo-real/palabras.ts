const VACIAS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'a', 'en', 'para', 'por', 'con', 'sin', 'al', 'un', 'una',
  'unos', 'unas', 'se', 'su', 'sus', 'que', 'requiere', 'compra', 'agil', 'ágil', 'adquisicion', 'adquisición',
  'adquisiciones', 'orden', 'oc', 'servicio', 'servicios', 'segun', 'según', 'cotizacion', 'cotización', 'n°', 'nº', 'no',
]);

/**
 * Palabras con las que se busca la compra ágil de una OC: el nombre de la OC
 * suele repetir el de la cotización ("ADQUISICION ELECTROCARDIOGRAFO." ↔
 * "ADQUISICION ELECTROCARDIOGRAFO PROGRAMA ..."). Se quitan palabras vacías,
 * números sueltos y signos; se dejan las más largas, que filtran mejor.
 */
export function palabrasClave(nombre: string | null | undefined, maximo = 4): string | null {
  if (!nombre) return null;
  const limpias = nombre
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4 && !/^\d+$/.test(p) && !VACIAS.has(p.toLowerCase()));
  if (limpias.length === 0) return null;
  const unicas = [...new Set(limpias.map((p) => p.toUpperCase()))];
  // Se respeta el orden original, pero se priorizan las más largas si sobran.
  const elegidas = unicas.length <= maximo
    ? unicas
    : unicas.filter((p) => [...unicas].sort((a, b) => b.length - a.length).slice(0, maximo).includes(p));
  return elegidas.join(' ');
}

/** "1196-267-AG26" → "1196": la unidad de compra, igual en la OC y en su COT. */
export function prefijoUnidad(codigo: string): string {
  return codigo.split('-')[0];
}

/** Sigla del tipo de OC desde el código: "1196-267-AG26" → "AG". */
export function tipoOcDesdeCodigo(codigo: string): string | null {
  return codigo.toUpperCase().match(/-([A-Z]{2})\d{2}$/)?.[1] ?? null;
}
