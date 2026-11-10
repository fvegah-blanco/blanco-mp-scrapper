import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronJobTriggerType } from '@prisma/client';
import { CronRegistryService, type CronRunResult } from '../cron-management/cron-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import { FichasOcService } from './fichas-oc.service';
import { MatchCompraAgilService } from './match-compra-agil.service';
import { OcTiempoRealService } from './oc-tiempo-real.service';

const POLL = 'oc-tiempo-real';
const POLL_HORARIO = '*/30 * * * *';
const FICHAS = 'oc-fichas';
const FICHAS_HORARIO = '2-59/10 * * * *';
const MATCH = 'compra-agil-match';
const MATCH_HORARIO = '7-59/15 * * * *';

/**
 * Tres crons, igual que en el back office cada uno administrable por separado:
 *  - oc-tiempo-real: trae las OC nuevas y en el mismo ciclo lee su ficha y
 *    busca su proceso (el match "en tiempo real");
 *  - oc-fichas y compra-agil-match: drenan lo que quedó pendiente (lotes, reintentos).
 */
@Injectable()
export class TiempoRealCron implements OnModuleInit {
  constructor(
    private readonly cronRegistry: CronRegistryService,
    private readonly prisma: PrismaService,
    private readonly poll: OcTiempoRealService,
    private readonly fichas: FichasOcService,
    private readonly match: MatchCompraAgilService,
  ) {}

  onModuleInit() {
    this.cronRegistry.register({
      name: POLL,
      description: 'Trae las OC nuevas del buscador, lee su ficha (contacto del comprador) y las cruza con su licitación o compra ágil',
      schedule: POLL_HORARIO,
      service: TiempoRealCron.name,
      executeFn: () => this.ejecutarPoll(),
    });
    this.cronRegistry.register({
      name: FICHAS,
      description: 'Lee las fichas públicas de OC pendientes: contacto del comprador y licitación de origen',
      schedule: FICHAS_HORARIO,
      service: TiempoRealCron.name,
      executeFn: () => this.ejecutarFichas(),
    });
    this.cronRegistry.register({
      name: MATCH,
      description: 'Cruza las OC de compra ágil pendientes con su cotización (COT) y lee las fichas de compra ágil (cotizaciones y ganador)',
      schedule: MATCH_HORARIO,
      service: TiempoRealCron.name,
      executeFn: () => this.ejecutarMatch(),
    });
  }

  @Cron(POLL_HORARIO, { name: POLL })
  async handlePoll(): Promise<void> {
    await this.cronRegistry.wrapExecution(POLL, CronJobTriggerType.CRON, () => this.ejecutarPoll());
  }

  @Cron(FICHAS_HORARIO, { name: FICHAS })
  async handleFichas(): Promise<void> {
    await this.cronRegistry.wrapExecution(FICHAS, CronJobTriggerType.CRON, () => this.ejecutarFichas());
  }

  @Cron(MATCH_HORARIO, { name: MATCH })
  async handleMatch(): Promise<void> {
    await this.cronRegistry.wrapExecution(MATCH, CronJobTriggerType.CRON, () => this.ejecutarMatch());
  }

  private async ejecutarPoll(): Promise<CronRunResult> {
    const r = await this.poll.poll();
    let fichas = { leidas: 0, contactos: 0, procesos: 0, fallidas: 0 };
    let match: Awaited<ReturnType<MatchCompraAgilService['procesar']>> | null = null;
    if (r.nuevas.length) {
      fichas = await this.fichas.procesar(r.nuevas);
      const ag = await this.prisma.ordenCompra.findMany({ where: { id: { in: r.nuevas }, tipo: 'AG' }, select: { id: true } });
      if (ag.length) match = await this.match.procesar(ag.map((o) => o.id));
    }
    return {
      itemsProcessed: r.vistas,
      itemsFailed: fichas.fallidas + (match?.fallidas ?? 0),
      metadata: { nuevas: r.nuevas.length, paginas: r.paginas, hasta: r.hasta, fichas, match },
    };
  }

  private async ejecutarFichas(): Promise<CronRunResult> {
    const r = await this.fichas.procesar();
    return { itemsProcessed: r.leidas, itemsFailed: r.fallidas, metadata: { contactos: r.contactos, procesos: r.procesos } };
  }

  private async ejecutarMatch(): Promise<CronRunResult> {
    const r = await this.match.procesar();
    return {
      itemsProcessed: r.intentadas + r.fichas.leidas,
      itemsFailed: r.fallidas + r.fichas.fallidas,
      metadata: { porTexto: r.porTexto, porBusqueda: r.porBusqueda, fichas: r.fichas },
    };
  }
}
