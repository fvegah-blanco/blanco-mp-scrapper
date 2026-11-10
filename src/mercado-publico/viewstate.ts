/**
 * Lectura del __VIEWSTATE de las fichas ASP.NET de mercadopublico.cl. La ficha
 * de una OC no muestra el contacto del comprador en el HTML (lo pinta como
 * imagen ofuscada), pero el ViewState lo trae en claro como strings con
 * prefijo de largo. Se extraen en orden y se leen como pares etiqueta → valor.
 */

/** Strings legibles del ViewState en el orden en que aparecen. */
export function stringsDelViewState(viewStateBase64: string): string[] {
  const b = Buffer.from(viewStateBase64, 'base64');
  const out: string[] = [];
  let i = 0;
  while (i < b.length - 1) {
    if (b[i] === 0x05) {
      // Largo en 7 bits por byte (como BinaryWriter.Write7BitEncodedInt).
      let largo = 0;
      let desplazamiento = 0;
      let j = i + 1;
      while (j < b.length) {
        const c = b[j++];
        largo |= (c & 0x7f) << desplazamiento;
        if (c < 0x80) break;
        desplazamiento += 7;
      }
      if (largo > 0 && largo < 2000 && j + largo <= b.length) {
        const s = b.subarray(j, j + largo).toString('utf8');
        if (!s.includes('�') && !/[\x00-\x08\x0E-\x1F]/.test(s)) {
          out.push(s);
          i = j + largo;
          continue;
        }
      }
    }
    i++;
  }
  return out;
}

export interface ContactoFicha {
  nombre: string | null;
  cargo: string | null;
  telefono: string | null;
  fax: string | null;
  email: string | null;
}

const ETIQUETAS: Record<string, keyof ContactoFicha> = {
  'nombre completo': 'nombre',
  contacto: 'nombre',
  cargo: 'cargo',
  'teléfono': 'telefono',
  telefono: 'telefono',
  fax: 'fax',
  'e-mail': 'email',
  email: 'email',
};

function esFinDeBloque(s: string): boolean {
  return /^\d+\s*\.-/.test(s) || s === 'Contacto del Proveedor' || s.startsWith('../') || s === 'Ver listado';
}

/** Lee un bloque etiqueta/valor desde `inicio`. Un valor vacío deja la etiqueta seguida de otra etiqueta. */
function leerBloque(strings: string[], inicio: number): ContactoFicha {
  const c: ContactoFicha = { nombre: null, cargo: null, telefono: null, fax: null, email: null };
  for (let i = inicio; i < strings.length && i < inicio + 30; i++) {
    const s = strings[i].trim();
    if (i > inicio && esFinDeBloque(s)) break;
    const campo = ETIQUETAS[s.toLowerCase()];
    if (!campo) continue;
    const valor = strings[i + 1]?.trim();
    if (!valor || ETIQUETAS[valor.toLowerCase()] || esFinDeBloque(valor) || valor.startsWith('Esta información')) continue;
    c[campo] = valor;
    i++;
  }
  return c;
}

const vacio = (c: ContactoFicha) => !c.nombre && !c.email && !c.telefono;

/** Contacto del comprador (sección 2) y, si es público, del proveedor (sección 5). */
export function contactosDeFichaOc(strings: string[]): { comprador: ContactoFicha | null; proveedor: ContactoFicha | null } {
  const iComprador = strings.findIndex((s) => s.trim() === 'Nombre Completo');
  const iProveedor = strings.findIndex((s) => s.trim() === 'Contacto del Proveedor');
  const comprador = iComprador >= 0 ? leerBloque(strings, iComprador) : null;
  const proveedor = iProveedor >= 0 ? leerBloque(strings, iProveedor + 1) : null;
  // En la sección del proveedor el nombre va justo después del título, sin etiqueta propia.
  const posibleNombre = iProveedor >= 0 ? strings[iProveedor + 1]?.trim() : undefined;
  if (proveedor && posibleNombre && !ETIQUETAS[posibleNombre.toLowerCase()] && !esFinDeBloque(posibleNombre)) {
    proveedor.nombre = posibleNombre;
  }
  return {
    comprador: comprador && !vacio(comprador) ? comprador : null,
    proveedor: proveedor && !vacio(proveedor) ? proveedor : null,
  };
}

/** URLs de imágenes ofuscadas (ImgOfuscar.aspx) que trae el ViewState. */
export function imagenesOfuscadas(strings: string[]): string[] {
  return strings
    .filter((s) => s.includes('ImgOfuscar.aspx?qs='))
    .map((s) => `https://www.mercadopublico.cl/${s.replace(/^(\.\.\/)+/, '')}`);
}
