/**
 * RUT chileno normalizado: sin puntos, con guion y DV en mayúscula
 * ("76.573.521-1" → "76573521-1"). Devuelve null si no parece un RUT.
 */
export function normalizarRut(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpio = valor.replace(/[^0-9kK]/g, '').toUpperCase();
  if (limpio.length < 2 || limpio.length > 9) return null;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return null;
  return `${Number(cuerpo)}-${dv}`;
}

/** Dígito verificador por módulo 11. */
export function calcularDv(cuerpo: string | number): string {
  let suma = 0;
  let multiplo = 2;
  const digitos = String(cuerpo).split('').reverse();
  for (const d of digitos) {
    suma += Number(d) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

/** true si el RUT normalizado tiene el DV correcto. */
export function rutValido(rut: string | null | undefined): boolean {
  const n = normalizarRut(rut);
  if (!n) return false;
  const [cuerpo, dv] = n.split('-');
  return calcularDv(cuerpo) === dv;
}
