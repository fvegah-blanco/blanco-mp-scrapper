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
  if (d.length === 9 && /^[2-9]/.test(d)) d = `56${d}`;
  if (!/^56\d{9}$/.test(d)) return null;
  return `+${d}`;
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
      if (!email && !telefono) continue;
      const clave = `${r.rut ?? ''}|${r.rol}|${email ?? ''}|${telefono ?? ''}`;
      filas.set(clave, [
        clave, r.rut, r.rol, r.nombre?.slice(0, 200) ?? null, r.cargo?.slice(0, 200) ?? null, email, telefono, r.fuente,
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
          cargo: `COALESCE("${t}"."cargo", EXCLUDED."cargo")`,
          confianza: `GREATEST("${t}"."confianza", EXCLUDED."confianza")`,
          veces_visto: `"${t}"."veces_visto" + 1`,
          ultima_vez_visto: 'now()',
        },
        noActualizar: ['rut', 'rol', 'email', 'telefono', 'fuente', 'proceso_codigo', 'orden_compra_id', 'documento_id', 'evidencia'],
      },
      [...filas.values()],
    );
  }
}
