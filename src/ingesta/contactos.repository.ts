import { Injectable } from '@nestjs/common';
import type { FuenteContacto, RolContacto } from '@prisma/client';
import { upsertLote } from '../common/upsert';
import { PrismaService } from '../prisma/prisma.service';

export interface ContactoReg {
  rut: string | null;
  rol: RolContacto;
  nombre?: string | null;
  cargo?: string | null;
  email?: string | null;
  telefono?: string | null;
  fuente: FuenteContacto;
  procesoCodigo?: string | null;
  ordenCompraId?: bigint | null;
  documentoId?: string | null;
  evidencia?: string | null;
  confianza: number;
}

/** "56-2-25767296", "(2) 2576 7296", "+56 9 8765 4321" → "+56225767296". null si no parece teléfono chileno. */
export function normalizarTelefono(valor: string | null | undefined): string | null {
  if (!valor) return null;
  let d = valor.replace(/\D/g, '');
  if (d.startsWith('0056')) d = d.slice(2);
  // Fijo de Santiago en formato antiguo (2 + 7 dígitos, antes de 2013): hoy lleva un 2 más.
  if (d.length === 8 && d.startsWith('2')) d = `562${d}`;
  if (d.length === 10 && d.startsWith('562') && !d.startsWith('5622')) d = `5622${d.slice(3)}`;
  if (d.length === 9 && /^[2-9]/.test(d)) d = `56${d}`;
  if (!/^56\d{9}$/.test(d)) return null;
  return `+${d}`;
}

export function claveContacto(rut: string | null, rol: string, email: string | null, telefono: string | null, nombre?: string | null): string {
  if (email) return `${rut ?? ''}|${rol}|${email}`;
  if (telefono) return `${rut ?? ''}|${rol}|tel:${telefono}`;
  const n = (nombre ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  return `${rut ?? ''}|${rol}|nombre:${n}`;
}

export function normalizarEmail(valor: string | null | undefined): string | null {
  const e = valor?.trim().toLowerCase().replace(/^mailto:/, '');
  return e && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : null;
}

@Injectable()
export class ContactosRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Guarda contactos; el mismo dato (rut, rol, email, teléfono) visto otra vez suma `veces_visto`. */
  async guardar(regs: ContactoReg[]): Promise<number> {
    const filas = new Map<string, unknown[]>();
    for (const r of regs) {
      const email = normalizarEmail(r.email);
      const telefono = normalizarTelefono(r.telefono);
      const limpiar = (v?: string | null) => v?.replace(/\s+/g, ' ').trim().slice(0, 200) || null;
      // Sin correo ni teléfono solo vale una persona con nombre leída de un documento (el
      // representante legal del Anexo N°1 suele venir así): dice quién firma por la empresa.
      if (!email && !telefono && !(r.fuente === 'DOCUMENTO_IA' && r.rut && limpiar(r.nombre))) continue;
      // La persona se identifica por su correo (o su teléfono, o su nombre): así un dato que
      // llega más completo después (con teléfono) completa la fila en vez de duplicarla.
      const clave = claveContacto(r.rut, r.rol, email, telefono, limpiar(r.nombre));
      filas.set(clave, [
        clave, r.rut, r.rol, limpiar(r.nombre), limpiar(r.cargo), email, telefono, r.fuente,
        r.procesoCodigo ?? null, r.ordenCompraId ?? null, r.documentoId ?? null, r.evidencia?.slice(0, 500) ?? null, r.confianza,
      ]);
    }
    if (filas.size === 0) return 0;
    const t = 'contactos';
    return upsertLote(
      this.prisma,
      {
        tabla: t,
        columnas: ['clave', 'rut', 'rol', 'nombre', 'cargo', 'email', 'telefono', 'fuente', 'proceso_codigo', 'orden_compra_id', 'documento_id', 'evidencia', 'confianza'],
        conflicto: ['clave'],
        actualizar: {
          nombre: `COALESCE("${t}"."nombre", EXCLUDED."nombre")`,
          telefono: `COALESCE("${t}"."telefono", EXCLUDED."telefono")`,
          cargo: `COALESCE("${t}"."cargo", EXCLUDED."cargo")`,
          confianza: `GREATEST("${t}"."confianza", EXCLUDED."confianza")`,
          // Si la IA confirma un dato que ya vio el regex, queda como fuente la IA (más completa).
          fuente: `CASE WHEN EXCLUDED."fuente" = 'DOCUMENTO_IA' THEN EXCLUDED."fuente" ELSE "${t}"."fuente" END`,
          veces_visto: `"${t}"."veces_visto" + 1`,
          ultima_vez_visto: 'now()',
        },
        noActualizar: ['rut', 'rol', 'email', 'proceso_codigo', 'orden_compra_id', 'documento_id', 'evidencia'],
      },
      [...filas.values()],
    );
  }
}
