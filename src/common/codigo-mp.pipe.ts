import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

/** Forma de todo código de Mercado Público: 799512-11-LE26, 1196-63-COT26, 1196-267-AG26. */
export const RE_CODIGO_MP = /^\d{1,10}-\d{1,8}-[A-Z0-9]{2,8}$/;

export function normalizarCodigoMp(valor: unknown): string | null {
  const codigo = typeof valor === 'string' ? valor.trim().toUpperCase() : '';
  return RE_CODIGO_MP.test(codigo) ? codigo : null;
}

/**
 * Valida y normaliza (mayúsculas) un código de proceso u OC que llega por la URL.
 * El código termina en rutas de almacenamiento y en URLs del portal, así que no
 * se acepta nada que no tenga la forma de un código real.
 */
@Injectable()
export class CodigoMpPipe implements PipeTransform<string, string> {
  transform(valor: string): string {
    const codigo = normalizarCodigoMp(valor);
    if (!codigo) throw new BadRequestException(`Código de Mercado Público inválido: ${String(valor).slice(0, 40)}`);
    return codigo;
  }
}
