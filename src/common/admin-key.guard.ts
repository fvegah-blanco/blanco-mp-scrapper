import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

const esProduccion = () => process.env.NODE_ENV === 'production';
const huella = (valor: string) => createHash('sha256').update(valor).digest();

/** En producción la llave es obligatoria: sin ella el proceso no arranca (ver main.ts). */
export function exigirLlaveEnProduccion(): void {
  if (esProduccion() && !process.env.ADMIN_API_KEY) {
    throw new Error('ADMIN_API_KEY es obligatoria con NODE_ENV=production');
  }
}

/**
 * Protege la API con el header `x-admin-key`. Sin ADMIN_API_KEY la API queda
 * abierta solo fuera de producción (desarrollo local); en producción se niega
 * todo. En el back office la auth es Better Auth con roles; este servicio es
 * interno y basta una llave.
 */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const esperada = process.env.ADMIN_API_KEY;
    if (!esperada) {
      if (esProduccion()) throw new ServiceUnavailableException('Falta configurar ADMIN_API_KEY');
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    // Se comparan las huellas: mismo largo siempre, sin filtrar el largo de la llave.
    if (!timingSafeEqual(huella(req.header('x-admin-key') ?? ''), huella(esperada))) {
      throw new UnauthorizedException('x-admin-key inválida');
    }
    return true;
  }
}

/** Quién hizo el cambio, para `updated_by`: header opcional `x-admin-user` (informativo, no autentica). */
export function usuarioDe(req: Request): string | undefined {
  return req.header('x-admin-user')?.slice(0, 120) || undefined;
}
