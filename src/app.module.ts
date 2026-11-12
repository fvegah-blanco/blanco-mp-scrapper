import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { LoggerModule } from 'nestjs-pino';
import { join } from 'path';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { ConsultasModule } from './consultas/consultas.module';
import { CronManagementModule } from './cron-management/cron-management.module';
import { DatosAbiertosModule } from './datos-abiertos/datos-abiertos.module';
import { DocumentosModule } from './documentos/documentos.module';
import { HealthController } from './health.controller';
import { IngestaModule } from './ingesta/ingesta.module';
import { MercadoPublicoModule } from './mercado-publico/mercado-publico.module';
import { PrismaModule } from './prisma/prisma.module';
import { TiempoRealModule } from './tiempo-real/tiempo-real.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        autoLogging: false,
        // La llave de administración y las cookies no se escriben en los logs.
        redact: ['req.headers["x-admin-key"]', 'req.headers.authorization', 'req.headers.cookie'],
        transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
    ScheduleModule.forRoot(),
    // Panel de administración estático en / (la API vive bajo /api).
    ServeStaticModule.forRoot({ rootPath: join(__dirname, '..', 'public'), exclude: ['/api/{*path}', '/docs/{*path}'] }),
    PrismaModule,
    CronManagementModule,
    ConfiguracionModule,
    IngestaModule,
    MercadoPublicoModule,
    DatosAbiertosModule,
    DocumentosModule,
    TiempoRealModule,
    ConsultasModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
