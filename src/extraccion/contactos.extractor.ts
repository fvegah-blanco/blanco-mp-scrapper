import type { RolContacto } from '@prisma/client';
import { normalizarEmail, normalizarTelefono } from '../ingesta/contactos.repository';
import { normalizarRut, rutValido } from '../common/rut';

/** Quiénes participan del proceso: sirve para decidir a quién pertenece cada dato. */
export interface ContextoProceso {
  compradorRut: string | null;
  compradorNombre: string | null;
  proveedores: Array<{ rut: string; nombre: string | null; adjudicado: boolean }>;
  /** Oferente que subió el documento (Anexo N°1, cotización). null en las bases del comprador. */
  duenoRut?: string | null;
}

export interface ContactoEncontrado {
  rol: RolContacto;
  rut: string | null;
  nombre: string | null;
  cargo: string | null;
  email: string | null;
  telefono: string | null;
  confianza: number;
  evidencia: string;
}

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// +56 9 1234 5678 · (56-2) 2576 7296 · 56-2-25767296 · 9 8765 4321 · 22 576 7296. El
// patrón es amplio a propósito: normalizarTelefono descarta lo que no da 9 dígitos chilenos.
const RE_TELEFONO = /(?:\+?\(?56\)?[\s.-]*)?(?:\(?\d{1,2}\)?[\s.-]*)?\d{3,4}[\s.-]{0,2}\d{4}\b/g;
const RE_RUT = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g;

const IGNORAR_DOMINIOS = ['mercadopublico.cl', 'chilecompra.cl', 'example.com', 'dominio.cl', 'correo.cl'];
export const DOMINIOS_PUBLICOS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.es', 'live.com', 'icloud.com', 'gmail.cl'];

const PALABRAS_PROVEEDOR = [
  'proveedor', 'oferente', 'contratista', 'adjudicatario', 'adjudicataria', 'representante legal', 'razón social del oferente',
  'empresa adjudicada', 'cotizante', 'vendedor', 'datos del oferente', 'identificación del oferente', 'mi representada',
];
const PALABRAS_COMPRADOR = [
  'unidad de compra', 'unidad requirente', 'contraparte técnica', 'contraparte tecnica', 'encargado de la licitación',
  'encargado de licitación', 'departamento de adquisiciones', 'municipalidad', 'servicio de salud', 'hospital', 'ministerio',
  'subsecretaría', 'gobierno regional', 'dirección de compras', 'entidad licitante', 'organismo comprador', 'mandante',
  'responsable de la licitación', 'inspector técnico', 'ito',
];

// Las palabras del nombre deben partir con mayúscula: así no se cuela el texto que sigue.
const RE_NOMBRE = /\b(?:[Nn]ombre(?: [Cc]ompleto)?|[Cc]ontacto|[Ee]ncargad[oa]|[Rr]esponsable|[Rr]epresentante [Ll]egal|[Aa]tenci[oó]n)\s*[:\-–]\s*((?:[A-ZÁÉÍÓÚÑ][\p{L}'.]+ ?){2,5})/u;
const RE_CARGO = /cargo\s*[:\-–]\s*([\p{L} .]{3,60})/iu;

function tokens(nombre: string | null): string[] {
  if (!nombre) return [];
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !['spa', 'ltda', 'limitada', 'sociedad', 'empresa', 'servicios', 'comercial', 'ilustre'].includes(t));
}

function sinTildes(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function dominioCoincide(email: string, nombre: string | null): boolean {
  const dominio = email.split('@')[1] ?? '';
  const base = dominio.split('.').slice(0, -1).join('');
  return tokens(nombre).some((t) => base.includes(t));
}

interface Hallazgo {
  tipo: 'email' | 'telefono';
  valor: string;
  pos: number;
}

/** La palabra clave de rol más cercana a `pos` (antes o después) dentro de la ventana. */
function rolPorPalabras(texto: string, pos: number, radio = 350): { rol: RolContacto; distancia: number } | null {
  const ini = Math.max(0, pos - radio);
  const ventana = sinTildes(texto.slice(ini, pos + radio));
  let mejor: { rol: RolContacto; distancia: number } | null = null;
  const revisar = (palabras: string[], rol: RolContacto) => {
    for (const p of palabras) {
      const clave = sinTildes(p);
      let i = ventana.indexOf(clave);
      while (i >= 0) {
        // Palabra completa (evita "ito" dentro de "requisito").
        const antes = ventana[i - 1] ?? ' ';
        const despues = ventana[i + clave.length] ?? ' ';
        if (!/[a-z0-9]/.test(antes) && !/[a-z0-9]/.test(despues)) {
          const d = Math.abs(ini + i - pos);
          if (!mejor || d < mejor.distancia) mejor = { rol, distancia: d };
        }
        i = ventana.indexOf(clave, i + 1);
      }
    }
  };
  revisar(PALABRAS_PROVEEDOR, 'PROVEEDOR');
  revisar(PALABRAS_COMPRADOR, 'COMPRADOR');
  return mejor;
}

/**
 * Busca correos y teléfonos en el texto de un adjunto y decide de quién son:
 * del comprador (el organismo, deudor de la factura) o de un proveedor (el
 * vendedor). Señales, de más a menos fuerte: un RUT conocido cerca, el dominio
 * del correo parecido al nombre de una de las partes, y palabras de contexto
 * ("oferente", "unidad requirente"...). Cada contacto lleva su evidencia para
 * revisarlo a mano.
 */
export function extraerContactos(texto: string, ctx: ContextoProceso): ContactoEncontrado[] {
  if (!texto) return [];
  const hallazgos: Hallazgo[] = [];
  // Correos con tilde ("atenciónalcliente@...") existen en los documentos: se buscan sin
  // tildes. Quitar las marcas tras NFD deja el mismo largo, así que las posiciones calzan.
  const sinMarcas = texto.normalize('NFC').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const base = sinMarcas.length === texto.length ? sinMarcas : texto;
  for (const m of base.matchAll(RE_EMAIL)) {
    const email = normalizarEmail(m[0]);
    if (!email || IGNORAR_DOMINIOS.some((d) => email.endsWith(d))) continue;
    hallazgos.push({ tipo: 'email', valor: email, pos: m.index ?? 0 });
  }
  for (const m of texto.matchAll(RE_TELEFONO)) {
    const tel = normalizarTelefono(m[0]);
    if (!tel) continue;
    // Un RUT o un monto con puntos también calza con el patrón: se descarta si es parte de uno.
    const alrededor = texto.slice(Math.max(0, (m.index ?? 0) - 3), (m.index ?? 0) + m[0].length + 3);
    if (/\d\.\d{3}\.\d{3}/.test(alrededor) || /-[\dkK]\b/.test(alrededor) || /\$\s*$/.test(texto.slice(Math.max(0, (m.index ?? 0) - 3), m.index))) continue;
    hallazgos.push({ tipo: 'telefono', valor: tel, pos: m.index ?? 0 });
  }
  hallazgos.sort((a, b) => a.pos - b.pos);

  const ruts: Array<{ rut: string; pos: number }> = [];
  for (const m of texto.matchAll(RE_RUT)) {
    if (rutValido(m[0])) ruts.push({ rut: normalizarRut(m[0])!, pos: m.index ?? 0 });
  }
  const proveedoresPorRut = new Map(ctx.proveedores.map((p) => [p.rut, p]));
  const adjudicados = ctx.proveedores.filter((p) => p.adjudicado);

  // Agrupa cada correo con el teléfono más cercano (a menos de 250 caracteres).
  const usados = new Set<Hallazgo>();
  const grupos: Hallazgo[][] = [];
  for (const h of hallazgos.filter((x) => x.tipo === 'email')) {
    const tel = hallazgos
      .filter((x) => x.tipo === 'telefono' && !usados.has(x) && Math.abs(x.pos - h.pos) < 250)
      .sort((a, b) => Math.abs(a.pos - h.pos) - Math.abs(b.pos - h.pos))[0];
    if (tel) usados.add(tel);
    grupos.push(tel ? [h, tel] : [h]);
  }
  for (const h of hallazgos.filter((x) => x.tipo === 'telefono' && !usados.has(x))) grupos.push([h]);

  const out: ContactoEncontrado[] = [];
  const vistos = new Set<string>();
  for (const g of grupos) {
    const email = g.find((x) => x.tipo === 'email')?.valor ?? null;
    const telefono = g.find((x) => x.tipo === 'telefono')?.valor ?? null;
    const pos = Math.min(...g.map((x) => x.pos));
    const ventanaIni = Math.max(0, pos - 300);
    const ventana = texto.slice(ventanaIni, pos + 300);

    let rol: RolContacto = 'DESCONOCIDO';
    let rut: string | null = null;
    let confianza = 0.3;

    // 1) RUT conocido cerca.
    const rutCerca = ruts
      .filter((r) => Math.abs(r.pos - pos) < 400)
      .sort((a, b) => Math.abs(a.pos - pos) - Math.abs(b.pos - pos))
      .find((r) => r.rut === ctx.compradorRut || proveedoresPorRut.has(r.rut));
    if (rutCerca) {
      rut = rutCerca.rut;
      rol = rutCerca.rut === ctx.compradorRut ? 'COMPRADOR' : 'PROVEEDOR';
      confianza = 0.9;
    }

    // 2) Dominio del correo.
    if (rol === 'DESCONOCIDO' && email) {
      const dominio = email.split('@')[1];
      const proveedorDominio = ctx.proveedores.find((p) => dominioCoincide(email, p.nombre));
      if (dominioCoincide(email, ctx.compradorNombre) || /\.(gob|gov)\.cl$|\.mun\.cl$|^(minsal|redsalud|ssm[a-z]*)\./.test(dominio)) {
        rol = 'COMPRADOR';
        rut = ctx.compradorRut;
        confianza = 0.75;
      } else if (proveedorDominio) {
        rol = 'PROVEEDOR';
        rut = proveedorDominio.rut;
        confianza = 0.75;
      }
    }

    // 3) Palabras de contexto.
    if (rol === 'DESCONOCIDO') {
      const porPalabras = rolPorPalabras(texto, pos);
      if (porPalabras) {
        rol = porPalabras.rol;
        confianza = porPalabras.distancia < 120 ? 0.6 : 0.45;
        if (rol === 'COMPRADOR') rut = ctx.compradorRut;
        else if (adjudicados.length === 1) rut = adjudicados[0].rut;
      } else if (email && DOMINIOS_PUBLICOS.includes(email.split('@')[1]) && adjudicados.length === 1) {
        // Un correo personal en un documento con un solo adjudicado suele ser del proveedor.
        rol = 'PROVEEDOR';
        rut = adjudicados[0].rut;
        confianza = 0.35;
      }
    }

    // En un documento subido por un oferente, lo que no tiene otra señal es del oferente.
    if (rol === 'DESCONOCIDO' && ctx.duenoRut) {
      rol = 'PROVEEDOR';
      rut = ctx.duenoRut;
      confianza = 0.5;
    }

    const clave = `${rol}|${email ?? ''}|${telefono ?? ''}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);

    out.push({
      rol,
      rut,
      nombre: ventana.match(RE_NOMBRE)?.[1]?.trim() ?? null,
      cargo: ventana.match(RE_CARGO)?.[1]?.trim() ?? null,
      email,
      telefono,
      confianza,
      evidencia: ventana.replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}
