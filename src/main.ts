import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { NextFunction, Request, Response } from 'express';
import { exigirLlaveEnProduccion } from './common/admin-key.guard';
import { esperarTrabajoEnCurso } from './common/en-trabajo';
import { PrismaErrorFilter } from './common/prisma-error.filter';

// Los IDs de MP (OC, ítems) son BIGINT: se serializan como string en el JSON.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

// El panel es un HTML con script y estilos en línea, y la tipografía viene de Google Fonts.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

async function bootstrap() {
  exigirLlaveEnProduccion();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new PrismaErrorFilter());
  app.enableShutdownHooks();

  // Swagger en /docs: siempre en desarrollo; en producción solo con DOCS_ENABLED=true.
  if (process.env.NODE_ENV !== 'production' || process.env.DOCS_ENABLED === 'true') {
    const doc = new DocumentBuilder()
      .setTitle('blanco-mp-scrapper')
      .setDescription('Ingesta de Mercado Público con crons administrables. Respuestas: { success, data } y, en listados, total/page/limit.')
      .addApiKey({ type: 'apiKey', name: 'x-admin-key', in: 'header' }, 'x-admin-key')
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
  }

  // Un redeploy espera hasta 2 min a que termine el cron que está corriendo.
  process.once('SIGTERM', () => void esperarTrabajoEnCurso(120_000).then(() => app.close()));

  await app.listen(Number(process.env.PORT ?? 4500));
}
void bootstrap();
