import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/**
 * Protege la API de administración con el header `x-admin-key`. Sin
 * ADMIN_API_KEY la API queda abierta (desarrollo local). En el back office la
 * auth es Better Auth con roles; este servicio es interno y basta una llave.
 */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const esperada = process.env.ADMIN_API_KEY;
    if (!esperada) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const recibida = req.header('x-admin-key') ?? '';
    const a = Buffer.from(recibida);
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('x-admin-key inválida');
    }
    return true;
  }
}

/** Quién hizo el cambio, para `updated_by`: header opcional `x-admin-user`. */
export function usuarioDe(req: Request): string | undefined {
  return req.header('x-admin-user') ?? undefined;
}
