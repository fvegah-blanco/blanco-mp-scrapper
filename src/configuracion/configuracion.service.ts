import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type ClaveParametro, PARAMETROS } from './parametros';

type ValorDe<K extends ClaveParametro> = (typeof PARAMETROS)[K]['valor'] extends number
  ? number
  : (typeof PARAMETROS)[K]['valor'] extends boolean
    ? boolean
    : (typeof PARAMETROS)[K]['valor'];

@Injectable()
export class ConfiguracionService {
  constructor(private readonly prisma: PrismaService) {}

  async get<K extends ClaveParametro>(clave: K): Promise<ValorDe<K>> {
    const fila = await this.prisma.configuracion.findUnique({ where: { clave } });
    return (fila ? fila.valor : PARAMETROS[clave].valor) as ValorDe<K>;
  }

  async listar() {
    const filas = await this.prisma.configuracion.findMany();
    const mapa = new Map(filas.map((f) => [f.clave, f]));
    return (Object.keys(PARAMETROS) as ClaveParametro[]).map((clave) => {
      const fila = mapa.get(clave);
      return {
        clave,
        valor: fila ? fila.valor : PARAMETROS[clave].valor,
        valorPorDefecto: PARAMETROS[clave].valor,
        descripcion: PARAMETROS[clave].descripcion,
        modificado: Boolean(fila),
        updatedBy: fila?.updatedBy ?? null,
        updatedAt: fila?.updatedAt ?? null,
      };
    });
  }

  async set(clave: string, valor: unknown, updatedBy?: string) {
    if (!(clave in PARAMETROS)) throw new BadRequestException(`Parámetro desconocido: ${clave}`);
    const defecto = PARAMETROS[clave as ClaveParametro].valor;
    if (typeof valor !== typeof defecto || (typeof valor === 'number' && !Number.isFinite(valor))) {
      throw new BadRequestException(`${clave} espera un ${typeof defecto}`);
    }
    await this.prisma.configuracion.upsert({
      where: { clave },
      create: { clave, valor: valor as Prisma.InputJsonValue, updatedBy },
      update: { valor: valor as Prisma.InputJsonValue, updatedBy },
    });
  }

  async restablecer(clave: string) {
    // Solo parámetros: las marcas de agua internas (`marca.*`) comparten tabla y no se borran por la API.
    if (!(clave in PARAMETROS)) throw new BadRequestException(`Parámetro desconocido: ${clave}`);
    await this.prisma.configuracion.deleteMany({ where: { clave } });
  }

  /** Marcas de agua internas de los crons (no se listan como parámetros). */
  async leerMarca(clave: string): Promise<string | null> {
    const fila = await this.prisma.configuracion.findUnique({ where: { clave: `marca.${clave}` } });
    return fila ? String(fila.valor) : null;
  }

  async guardarMarca(clave: string, valor: string): Promise<void> {
    await this.prisma.configuracion.upsert({
      where: { clave: `marca.${clave}` },
      create: { clave: `marca.${clave}`, valor, descripcion: 'Marca de agua interna' },
      update: { valor },
    });
  }
}
