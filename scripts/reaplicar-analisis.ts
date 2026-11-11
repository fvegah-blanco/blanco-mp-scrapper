/**
 * Vuelve a pasar las respuestas de Bedrock ya guardadas por las reglas de
 * contactosDe (filtros, roles, representante legal) sin llamar al modelo.
 * Uso: npx ts-node -T scripts/reaplicar-analisis.ts
 */
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ConfiguracionService } from '../src/configuracion/configuracion.service';
import { type AnalisisAnexo, AnalisisIaService } from '../src/extraccion/analisis-ia.service';
import { ContactosRepository } from '../src/ingesta/contactos.repository';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const analisis = app.get(AnalisisIaService);
  const contactos = app.get(ContactosRepository);
  const max = await app.get(ConfiguracionService).get('bedrock.max_contactos_documento');
  const docs = await prisma.documento.findMany({ where: { analisisIaEstado: 'OK', analisisIa: { not: undefined } } });
  let total = 0;
  for (const d of docs) {
    if (!d.analisisIa) continue;
    total += await contactos.guardar(await analisis.contactosDe(d, d.analisisIa as unknown as AnalisisAnexo, d.analisisIaModelo ?? undefined, max));
  }
  console.log(`documentos ${docs.length}, filas guardadas ${total}`);
  await app.close();
}
void main();
