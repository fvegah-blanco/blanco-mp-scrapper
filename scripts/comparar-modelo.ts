/**
 * Compara otro modelo de Bedrock contra lo ya analizado (sin tocar la base):
 * mismo prompt, esquema y contenido (texto fiel + páginas como imagen) que
 * AnalisisIaService. Uso:
 *   npx ts-node -T scripts/comparar-modelo.ts <modelo> <archivo-ids> <salida.json>
 * `openai.*` va por Mantle; el resto por Converse.
 */
import 'dotenv/config';
import 'reflect-metadata';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createBedrockMantle } from '@ai-sdk/amazon-bedrock/mantle';
import { NestFactory } from '@nestjs/core';
import { generateText, type LanguageModel, Output, type UserContent } from 'ai';
import { readFileSync, writeFileSync } from 'fs';
import { AppModule } from '../src/app.module';
import { AnalisisIaService, esquemaAnexo, SISTEMA } from '../src/extraccion/analisis-ia.service';
import { PrismaService } from '../src/prisma/prisma.service';

const [modeloId, archivoIds, salida] = process.argv.slice(2);
const region = process.env.BEDROCK_AWS_REGION ?? 'us-east-2';
const credenciales = {
  accessKeyId: process.env.BEDROCK_AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.BEDROCK_AWS_SECRET_ACCESS_KEY!,
};

function modelo(id: string): LanguageModel {
  if (id.startsWith('openai.')) {
    return createBedrockMantle({ region, ...credenciales, baseURL: `https://bedrock-mantle.${region}.api.aws/openai/v1` }).responses(id);
  }
  return createAmazonBedrock({ region, ...credenciales })(id);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const analisis = app.get(AnalisisIaService) as unknown as { armarContenido(d: unknown): Promise<UserContent | null> };
  const ids = readFileSync(archivoIds, 'utf8').trim().split('\n');
  const m = modelo(modeloId);
  const out: unknown[] = [];
  for (const id of ids) {
    const doc = await prisma.documento.findUniqueOrThrow({ where: { id } });
    const contenido = await analisis.armarContenido(doc);
    if (!contenido) continue;
    const inicio = Date.now();
    try {
      const { output, usage } = await generateText({
        model: m,
        system: SISTEMA,
        messages: [{ role: 'user', content: contenido }],
        output: Output.object({ schema: esquemaAnexo }),
        ...(/claude-haiku-4-5/.test(modeloId) ? { providerOptions: { bedrock: { structuredOutputMode: 'outputFormat' } } } : {}),
      });
      out.push({ id, nombre: doc.nombre, ms: Date.now() - inicio, entrada: usage.inputTokens, salida: usage.outputTokens, razonamiento: usage.outputTokenDetails?.reasoningTokens ?? null, output });
      console.log(doc.nombre, Date.now() - inicio, usage.inputTokens, usage.outputTokens);
    } catch (e) {
      out.push({ id, nombre: doc.nombre, ms: Date.now() - inicio, error: (e as Error).message });
      console.log('ERROR', doc.nombre, (e as Error).message.slice(0, 200));
    }
    writeFileSync(salida, JSON.stringify(out, null, 1));
  }
  await app.close();
}
void main();
