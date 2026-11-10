import { Controller, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
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
  ) {}

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
