import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronJobTriggerType } from '@prisma/client';
import { CronRegistryService, type CronRunResult } from '../cron-management/cron-registry.service';
import { AnalisisIaService } from '../extraccion/analisis-ia.service';
import { ExtraccionService } from '../extraccion/extraccion.service';
import { AdjuntosService } from './adjuntos.service';

const ADJUNTOS = 'adjuntos-descarga';
const ADJUNTOS_HORARIO = '*/15 * * * *';

@Injectable()
export class DocumentosCron implements OnModuleInit {
  constructor(
    private readonly cronRegistry: CronRegistryService,
    private readonly adjuntos: AdjuntosService,
  ) {}

  onModuleInit() {
    this.cronRegistry.register({
      name: ADJUNTOS,
      description: 'Descarga los adjuntos de licitaciones y compras ágiles encoladas (adjuntos_estado = PENDIENTE)',
      schedule: ADJUNTOS_HORARIO,
      service: DocumentosCron.name,
      executeFn: () => this.ejecutar(),
    });
  }

  @Cron(ADJUNTOS_HORARIO, { name: ADJUNTOS })
  async handleCron(): Promise<void> {
    await this.cronRegistry.wrapExecution(ADJUNTOS, CronJobTriggerType.CRON, () => this.ejecutar());
  }

  private async ejecutar(): Promise<CronRunResult> {
    const r = await this.adjuntos.procesarLote();
    return { itemsProcessed: r.archivos, itemsFailed: r.fallidos, metadata: { procesos: r.procesos } };
  }
}

const EXTRACCION = 'documentos-extraccion';
const EXTRACCION_HORARIO = '5-59/10 * * * *';

@Injectable()
export class ContactosExtraccionCron implements OnModuleInit {
  constructor(
    private readonly cronRegistry: CronRegistryService,
    private readonly extraccion: ExtraccionService,
  ) {}

  onModuleInit() {
    this.cronRegistry.register({
      name: EXTRACCION,
      description: 'Extrae texto (OCR si es escaneado) de los adjuntos descargados y busca contactos de comprador y proveedor',
      schedule: EXTRACCION_HORARIO,
      service: ContactosExtraccionCron.name,
      executeFn: () => this.ejecutar(),
    });
  }

  @Cron(EXTRACCION_HORARIO, { name: EXTRACCION })
  async handleCron(): Promise<void> {
    await this.cronRegistry.wrapExecution(EXTRACCION, CronJobTriggerType.CRON, () => this.ejecutar());
  }

  private async ejecutar(): Promise<CronRunResult> {
    const r = await this.extraccion.procesarLote();
    return { itemsProcessed: r.documentos, itemsFailed: r.fallidos, metadata: { conTexto: r.conTexto, contactos: r.contactos } };
  }
}

const ANALISIS_IA = 'documentos-analisis-ia';
const ANALISIS_IA_HORARIO = '8-59/10 * * * *';

@Injectable()
export class AnalisisIaCron implements OnModuleInit {
  constructor(
    private readonly cronRegistry: CronRegistryService,
    private readonly analisis: AnalisisIaService,
  ) {}

  onModuleInit() {
    this.cronRegistry.register({
      name: ANALISIS_IA,
      description: 'Lee con Bedrock los documentos del oferente (Anexo N°1, cotizaciones) y guarda los contactos del vendedor',
      schedule: ANALISIS_IA_HORARIO,
      service: AnalisisIaCron.name,
      executeFn: () => this.ejecutar(),
    });
  }

  @Cron(ANALISIS_IA_HORARIO, { name: ANALISIS_IA })
  async handleCron(): Promise<void> {
    await this.cronRegistry.wrapExecution(ANALISIS_IA, CronJobTriggerType.CRON, () => this.ejecutar());
  }

  private async ejecutar(): Promise<CronRunResult> {
    const r = await this.analisis.procesarLote();
    return { itemsProcessed: r.analizados, itemsFailed: r.fallidos, metadata: { contactos: r.contactos, ...(r.omitido ? { omitido: r.omitido } : {}) } };
  }
}
