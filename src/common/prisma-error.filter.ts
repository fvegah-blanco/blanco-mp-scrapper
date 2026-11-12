import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Un registro que no existe (P2025) responde 404 en vez de 500. El resto sigue al manejador por defecto. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaErrorFilter implements ExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error.code === 'P2025') {
      return res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'Registro no encontrado', error: 'Not Found' });
    }
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: 'Internal server error' });
  }
}
