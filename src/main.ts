import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { esperarTrabajoEnCurso } from './common/en-trabajo';

// Los IDs de MP (OC, ítems) son BIGINT: se serializan como string en el JSON.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('blanco-mp-scrapper')
    .setDescription('Ingesta de Mercado Público con crons administrables')
    .addApiKey({ type: 'apiKey', name: 'x-admin-key', in: 'header' }, 'x-admin-key')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));

  // Un redeploy espera hasta 2 min a que termine el cron que está corriendo.
  process.once('SIGTERM', () => void esperarTrabajoEnCurso(120_000).then(() => app.close()));

  await app.listen(Number(process.env.PORT ?? 4500));
}
void bootstrap();
