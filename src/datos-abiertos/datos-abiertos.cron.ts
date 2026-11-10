import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronJobTriggerType } from '@prisma/client';
import { CronRegistryService, type CronRunResult } from '../cron-management/cron-registry.service';
import { DatosAbiertosService } from './datos-abiertos.service';

const NOMBRE = 'datos-abiertos-sync';
const HORARIO = '0 5 * * *';
const ZONA = 'America/Santiago';

@Injectable()
export class DatosAbiertosCron implements OnModuleInit {
  constructor(
    private readonly cronRegistry: CronRegistryService,
    private readonly datosAbiertos: DatosAbiertosService,
  ) {}

  onModuleInit() {
    this.cronRegistry.register({
      name: NOMBRE,
      description:
        'Descarga masiva por URL (oc-da y lic-da): backfill del año en curso y reproceso de los meses cuyo ETag cambió',
      schedule: HORARIO,
      timeZone: ZONA,
      service: DatosAbiertosCron.name,
      executeFn: () => this.ejecutar(),
    });
  }

  @Cron(HORARIO, { name: NOMBRE, timeZone: ZONA })
  async handleCron(): Promise<void> {
    await this.cronRegistry.wrapExecution(NOMBRE, CronJobTriggerType.CRON, () => this.ejecutar());
  }

  private async ejecutar(): Promise<CronRunResult> {
    const r = await this.datosAbiertos.sincronizar();
    return {
      itemsProcessed: r.procesados,
      itemsFailed: r.fallidos,
      metadata: { filas: r.filas, sinCambios: r.sinCambios, detalle: r.detalle },
    };
  }
}
