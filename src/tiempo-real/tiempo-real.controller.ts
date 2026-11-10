import { Controller, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { BuscadorClient } from '../mercado-publico/buscador.client';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { PrismaService } from '../prisma/prisma.service';
import { FichasOcService } from './fichas-oc.service';
import { MatchCompraAgilService } from './match-compra-agil.service';

@ApiTags('Tiempo real')
@ApiHeader({ name: 'x-admin-key', required: false })
@UseGuards(AdminKeyGuard)
@Controller('tiempo-real')
export class TiempoRealController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fichas: FichasOcService,
    private readonly match: MatchCompraAgilService,
    private readonly buscador: BuscadorClient,
  ) {}

  /** Relee la ficha de una compra ágil (cotizaciones, ganador, id de cada cotización). */
  @Post('compras-agiles/:codigo/ficha')
  async fichaCompraAgil(@Param('codigo') codigo: string) {
    const ficha = await this.buscador.fichaCompraAgil(codigo);
    if (!ficha) throw new NotFoundException(`El buscador no tiene ficha para ${codigo}`);
    await this.match.guardarCompraAgil(ficha);
    const ofertas = await this.prisma.oferta.findMany({ where: { procesoCodigo: ficha.codigo.toUpperCase() }, select: { proveedorRut: true, valorTotal: true, seleccionada: true, idExterno: true } });
    return { success: true, data: { codigo: ficha.codigo, estado: ficha.estado, ofertas } };
  }

  /** Lee la ficha y busca el proceso de una OC puntual, ahora. */
  @Post('ordenes/:codigo/cruzar')
  async cruzar(@Param('codigo') codigo: string) {
    const oc = await this.prisma.ordenCompra.findUnique({ where: { codigo: codigo.toUpperCase() } });
    if (!oc) throw new NotFoundException(`OC ${codigo} no está en la base`);
    await this.prisma.ordenCompra.update({ where: { id: oc.id }, data: { fichaRevisadaAt: null, matchIntentos: 0 } });
    const fichas = await this.fichas.procesar([oc.id]);
    const match = oc.tipo === 'AG' ? await this.match.procesar([oc.id]) : null;
    const actualizada = await this.prisma.ordenCompra.findUnique({ where: { id: oc.id }, select: { codigo: true, procesoCodigo: true, fichaError: true } });
    return { success: true, data: { ...actualizada, fichas, match } };
  }
}
