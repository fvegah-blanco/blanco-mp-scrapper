import {
  type BeforeApplicationShutdown,
  Injectable,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import {
  CronJobRunStatus,
  CronJobTriggerType,
  Prisma,
  type CronJobRun,
} from '@prisma/client';
import { CronTime } from 'cron';
import { randomUUID } from 'crypto';
import { enTrabajo } from '../common/en-trabajo';
import { getErrorMessage } from '../common/errores';
import { configurarTurnosCron, tomarTurnoCron } from './turno-cron';

export interface CronRunResult {
  itemsProcessed?: number;
  itemsFailed?: number;
  metadata?: Record<string, unknown>;
}

export interface CronJobDefinition {
  name: string;
  description: string;
  schedule: string;
  timeZone?: string;
  service: string;
  executeFn: () => Promise<CronRunResult>;
}

@Injectable()
export class CronRegistryService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly jobs = new Map<string, CronJobDefinition>();
  private readonly pausedJobs = new Set<string>();
  private readonly runningJobs = new Set<string>();
  /** Fila de CronJobRun de cada job que corre ahora en este proceso. */
  private readonly runsEnCurso = new Map<string, string>();

  /**
   * Interruptor de crons para *este* proceso: `true` los corre todos, `false`
   * ninguno, y sin la variable manda `cron_jobs_config` en la base, que es el
   * comportamiento de siempre y el que se configura desde el back office.
   *
   * Existe porque el on/off por job vive en la base, y esa base la comparten
   * todos los contenedores del ambiente. Sin esto, apagar un cron para que no
   * corra en el worker de colas lo apagaría también en la API. `null` significa
   * "no hay variable, decide la base".
   */
  private readonly cronsEnabledEnv: boolean | null =
    process.env.CRONS_ENABLED === undefined || process.env.CRONS_ENABLED === ''
      ? null
      : process.env.CRONS_ENABLED === 'true'
        ? true
        : process.env.CRONS_ENABLED === 'false'
          ? false
          : null;

  constructor(
    @InjectPinoLogger(CronRegistryService.name)
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    configurarTurnosCron(prisma, schedulerRegistry);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.loadPersistedState();
  }

  register(def: CronJobDefinition): void {
    this.jobs.set(def.name, def);
  }

  private async loadPersistedState(): Promise<void> {
    const configs = await this.prisma.cronJobConfig.findMany();
    const configMap = new Map(configs.map((c) => [c.jobName, c]));

    if (
      process.env.CRONS_ENABLED !== undefined &&
      process.env.CRONS_ENABLED !== '' &&
      this.cronsEnabledEnv === null
    ) {
      this.logger.warn(
        { event: 'cron-env-invalid', value: process.env.CRONS_ENABLED },
        `CRONS_ENABLED="${process.env.CRONS_ENABLED}" no es 'true' ni 'false'; se ignora y decide la base`,
      );
    }

    for (const [jobName] of this.jobs) {
      const config = configMap.get(jobName);

      // Sin variable de entorno decide la base; sin fila en la base, encendido.
      const enabled = this.cronsEnabledEnv ?? config?.enabled ?? true;
      if (!enabled) {
        this.pauseJobInternal(jobName);
      }

      // El horario override se aplica igual: es independiente del on/off.
      if (config?.scheduleOverride) {
        this.applyScheduleOverride(
          jobName,
          config.scheduleOverride,
          config.timeZoneOverride ?? undefined,
        );
      }
    }

    this.logger.info(
      {
        event: 'cron-config-loaded',
        jobCount: this.jobs.size,
        configCount: configs.length,
        cronsEnabledEnv: this.cronsEnabledEnv,
      },
      this.cronsEnabledEnv === null
        ? 'Loaded persisted cron job configuration'
        : `Cron jobs forzados por CRONS_ENABLED=${String(this.cronsEnabledEnv)} (se ignora la config de la base)`,
    );
  }

  async wrapExecution(
    jobName: string,
    triggeredBy: CronJobTriggerType,
    fn: () => Promise<CronRunResult>,
  ): Promise<CronJobRun | null> {
    if (this.runningJobs.has(jobName)) {
      this.logger.info(
        { cronJob: jobName, event: 'skipped' },
        `Cron job ${jobName} skipped — previous run still in progress`,
      );
      return null;
    }

    // Se reserva antes de consultar el turno: un segundo tick de esta misma
    // instancia no se cuela mientras la consulta está en vuelo.
    this.runningJobs.add(jobName);

    // En un rolling update corren dos instancias: el tick lo corre una sola.
    // Un disparo manual desde el panel no compite por el turno.
    if (
      triggeredBy === CronJobTriggerType.CRON &&
      !(await tomarTurnoCron(jobName))
    ) {
      this.runningJobs.delete(jobName);
      this.logger.debug(
        { cronJob: jobName, event: 'skipped-turno' },
        `Cron job ${jobName} skipped — el turno lo tomó otra instancia`,
      );
      return null;
    }

    // Cuenta como trabajo en curso: el apagado ordenado lo espera. El finally
    // libera la reserva aunque falle la creación de la fila del run.
    try {
      return await enTrabajo(() => this.ejecutar(jobName, triggeredBy, fn));
    } finally {
      this.runningJobs.delete(jobName);
    }
  }

  private async ejecutar(
    jobName: string,
    triggeredBy: CronJobTriggerType,
    fn: () => Promise<CronRunResult>,
  ): Promise<CronJobRun> {
    const runId = randomUUID();

    this.logger.info(
      { cronJob: jobName, runId, event: 'start', triggeredBy },
      `Cron job ${jobName} starting`,
    );

    const run = await this.prisma.cronJobRun.create({
      data: {
        jobName,
        runId,
        status: CronJobRunStatus.RUNNING,
        triggeredBy,
      },
    });

    this.runsEnCurso.set(jobName, run.id);
    const start = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - start;

      const updated = await this.prisma.cronJobRun.update({
        where: { id: run.id },
        data: {
          status: CronJobRunStatus.SUCCESS,
          finishedAt: new Date(),
          durationMs,
          itemsProcessed: result.itemsProcessed ?? 0,
          itemsFailed: result.itemsFailed ?? 0,
          metadata: (result.metadata ??
            Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });

      this.logger.info(
        {
          cronJob: jobName,
          runId,
          event: 'end',
          status: 'SUCCESS',
          durationMs,
          itemsProcessed: result.itemsProcessed ?? 0,
          itemsFailed: result.itemsFailed ?? 0,
        },
        `Cron job ${jobName} completed`,
      );

      return updated;
    } catch (error) {
      const durationMs = Date.now() - start;
      const errorMsg = getErrorMessage(error).substring(0, 2000);

      const updated = await this.prisma.cronJobRun.update({
        where: { id: run.id },
        data: {
          status: CronJobRunStatus.FAILED,
          finishedAt: new Date(),
          durationMs,
          errorMessage: errorMsg,
        },
      });

      this.logger.error(
        {
          cronJob: jobName,
          runId,
          event: 'error',
          status: 'FAILED',
          durationMs,
          error: errorMsg,
        },
        `Cron job ${jobName} failed`,
      );

      return updated;
    } finally {
      this.runningJobs.delete(jobName);
      this.runsEnCurso.delete(jobName);
    }
  }

  /**
   * Corre dentro de `app.close()`, después del drenaje: lo que siga corriendo
   * se va a cortar con el proceso. Se marca FAILED para que la fila no quede
   * en RUNNING para siempre en el panel.
   */
  async beforeApplicationShutdown(): Promise<void> {
    if (this.runsEnCurso.size === 0) return;
    const ids = [...this.runsEnCurso.values()];
    await this.prisma.cronJobRun
      .updateMany({
        where: { id: { in: ids }, status: CronJobRunStatus.RUNNING },
        data: {
          status: CronJobRunStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: 'Interrumpido por el apagado del contenedor (redeploy)',
        },
      })
      .catch((error: unknown) =>
        this.logger.warn(
          { event: 'shutdown-mark-failed', error: getErrorMessage(error) },
          'No se pudieron marcar los crons interrumpidos',
        ),
      );
  }

  async listJobs(): Promise<
    Array<
      CronJobDefinition & {
        state: 'active' | 'paused';
        defaultSchedule: string;
        activeSchedule: string;
        scheduleOverride?: string | null;
        defaultTimeZone?: string;
        activeTimeZone?: string;
        nextRun?: string;
        lastRun?: {
          status: CronJobRunStatus;
          startedAt: Date;
          durationMs: number | null;
        };
      }
    >
  > {
    const jobNames = Array.from(this.jobs.keys());

    const [lastRuns, configs] = await Promise.all([
      jobNames.length > 0
        ? this.prisma.cronJobRun.findMany({
            where: {
              jobName: { in: jobNames },
              status: { not: CronJobRunStatus.RUNNING },
            },
            orderBy: { startedAt: 'desc' },
            distinct: ['jobName'],
            select: {
              jobName: true,
              status: true,
              startedAt: true,
              durationMs: true,
            },
          })
        : [],
      jobNames.length > 0
        ? this.prisma.cronJobConfig.findMany({
            where: { jobName: { in: jobNames } },
          })
        : [],
    ]);

    const lastRunMap = new Map(lastRuns.map((r) => [r.jobName, r] as const));
    const configMap = new Map(configs.map((c) => [c.jobName, c] as const));

    return Array.from(this.jobs.values()).map((def) => {
      const config = configMap.get(def.name);
      const activeSchedule = config?.scheduleOverride ?? def.schedule;
      const activeTimeZone = config?.timeZoneOverride ?? def.timeZone;

      let nextRun: string | undefined;
      try {
        const cronJob = this.schedulerRegistry.getCronJob(def.name);
        const nextDate = cronJob.nextDate();
        nextRun = nextDate.toISO() ?? undefined;
      } catch {
        // Job not found in scheduler (env-gated or not yet registered)
      }

      const last = lastRunMap.get(def.name);

      return {
        ...def,
        executeFn: undefined as unknown as CronJobDefinition['executeFn'],
        state: this.pausedJobs.has(def.name)
          ? ('paused' as const)
          : ('active' as const),
        defaultSchedule: def.schedule,
        activeSchedule,
        scheduleOverride: config?.scheduleOverride ?? null,
        defaultTimeZone: def.timeZone,
        activeTimeZone,
        nextRun,
        lastRun: last
          ? {
              status: last.status,
              startedAt: last.startedAt,
              durationMs: last.durationMs,
            }
          : undefined,
      };
    });
  }

  async pauseJob(name: string, updatedBy?: string): Promise<void> {
    this.assertJobExists(name);
    await this.prisma.cronJobConfig.upsert({
      where: { jobName: name },
      create: { jobName: name, enabled: false, updatedBy },
      update: { enabled: false, updatedBy },
    });
    this.pauseJobInternal(name);
  }

  async resumeJob(name: string, updatedBy?: string): Promise<void> {
    this.assertJobExists(name);
    await this.prisma.cronJobConfig.upsert({
      where: { jobName: name },
      create: { jobName: name, enabled: true, updatedBy },
      update: { enabled: true, updatedBy },
    });
    this.resumeJobInternal(name);
  }

  async updateSchedule(
    name: string,
    schedule: string,
    timeZone?: string,
    updatedBy?: string,
  ): Promise<void> {
    this.assertJobExists(name);
    this.applyScheduleOverride(name, schedule, timeZone);
    await this.prisma.cronJobConfig.upsert({
      where: { jobName: name },
      create: {
        jobName: name,
        scheduleOverride: schedule,
        timeZoneOverride: timeZone ?? null,
        updatedBy,
      },
      update: {
        scheduleOverride: schedule,
        timeZoneOverride: timeZone ?? null,
        updatedBy,
      },
    });
  }

  async resetSchedule(name: string, updatedBy?: string): Promise<void> {
    this.assertJobExists(name);
    const def = this.jobs.get(name)!;
    this.applyScheduleOverride(name, def.schedule, def.timeZone);
    await this.prisma.cronJobConfig.upsert({
      where: { jobName: name },
      create: { jobName: name, updatedBy },
      update: { scheduleOverride: null, timeZoneOverride: null, updatedBy },
    });
  }

  private pauseJobInternal(name: string): void {
    try {
      const cronJob = this.schedulerRegistry.getCronJob(name);
      void cronJob.stop();
    } catch {
      // Job not in scheduler — may be env-gated
    }
    this.pausedJobs.add(name);
  }

  private resumeJobInternal(name: string): void {
    if (this.cronsEnabledEnv === false) {
      // La config se guarda igual —la base es compartida y el cambio debe verse
      // en los contenedores que sí corren crons—, pero este proceso no arranca.
      this.logger.info(
        { cronJob: name, event: 'resume-ignored' },
        `Cron job ${name} habilitado en la base, pero este proceso corre con CRONS_ENABLED=false`,
      );
      return;
    }

    try {
      const cronJob = this.schedulerRegistry.getCronJob(name);
      cronJob.start();
    } catch {
      // Job not in scheduler
    }
    this.pausedJobs.delete(name);
  }

  private applyScheduleOverride(
    name: string,
    schedule: string,
    timeZone?: string,
  ): void {
    try {
      const cronJob = this.schedulerRegistry.getCronJob(name);
      const newTime = new CronTime(schedule, timeZone);
      cronJob.setTime(newTime);
      if (!this.pausedJobs.has(name)) {
        cronJob.start();
      }
    } catch (error) {
      this.logger.warn(
        { cronJob: name, schedule, error: getErrorMessage(error) },
        `Failed to apply schedule override for ${name}`,
      );
    }
  }

  async runJob(name: string): Promise<CronJobRun | null> {
    this.assertJobExists(name);
    const def = this.jobs.get(name)!;
    return this.wrapExecution(name, CronJobTriggerType.MANUAL, def.executeFn);
  }

  async getRunHistory(
    name: string,
    options: { page?: number; limit?: number } = {},
  ) {
    this.assertJobExists(name);

    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.cronJobRun.findMany({
        where: { jobName: name },
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.cronJobRun.count({ where: { jobName: name } }),
    ]);

    return {
      success: true,
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  isPaused(name: string): boolean {
    return this.pausedJobs.has(name);
  }

  isRunning(name: string): boolean {
    this.assertJobExists(name);
    return this.runningJobs.has(name);
  }

  private assertJobExists(name: string): void {
    if (!this.jobs.has(name)) {
      throw new NotFoundException(`Cron job '${name}' not found`);
    }
  }
}
