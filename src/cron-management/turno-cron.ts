import { hostname } from 'os';
import { Logger } from '@nestjs/common';
import type { SchedulerRegistry } from '@nestjs/schedule';
import type { PrismaService } from '../prisma/prisma.service';
import { enTrabajo } from '../common/en-trabajo';

/** Tope de la ventana: dos instancias disparan el mismo tick con segundos de diferencia. */
const VENTANA_MAXIMA_MS = 30_000;

/**
 * Quién tiene el turno. En Docker el hostname es el id del contenedor; el pid
 * distingue dos procesos en la misma máquina (dos `npm run dev`).
 */
const INSTANCIA = `${hostname()}:${process.pid}`;
const logger = new Logger('TurnoCron');

/**
 * Lo que necesita el turno para hablar con la base y leer el horario vivo de
 * cada job. Lo fija CronRegistryService al construirse: así el decorador
 * `@UnaInstancia` sirve en cualquier clase sin cambiarle el constructor.
 */
interface DependenciasTurno {
  prisma: Pick<PrismaService, '$queryRaw'>;
  scheduler: Pick<SchedulerRegistry, 'getCronJob'>;
}

let dependencias: DependenciasTurno | null = null;

export function configurarTurnosCron(
  prisma: DependenciasTurno['prisma'],
  scheduler: DependenciasTurno['scheduler'],
): void {
  dependencias = { prisma, scheduler };
}

/**
 * Cuánto dura el turno de un tick: la mitad del período del job, con tope de
 * 30 s. Un cron cada 10 s queda con 5 s y uno diario con 30 s. Se lee del
 * horario vivo (respeta el override del panel); sin job registrado, 30 s.
 */
export function ventanaDeTurnoMs(nombre: string): number {
  try {
    const job = dependencias?.scheduler.getCronJob(nombre);
    const [a, b] = job?.cronTime.sendAt(2) ?? [];
    if (!a || !b) return VENTANA_MAXIMA_MS;
    const periodo = b.toMillis() - a.toMillis();
    return Math.min(VENTANA_MAXIMA_MS, Math.floor(periodo / 2));
  } catch {
    return VENTANA_MAXIMA_MS;
  }
}

/**
 * Toma el turno de este tick para el job. En un rolling update corren dos
 * API a la vez y los `@Cron` no tienen lock propio: sin esto, un cron que cae
 * en esa ventana corre dos veces (un nudge de WhatsApp repetido, una
 * notificación duplicada).
 *
 * Es una sola sentencia atómica, así que sirve con el pooler de Supabase en
 * modo transacción (un advisory lock de sesión no). Devuelve `false` si otra
 * instancia ya tomó el turno dentro de la ventana; si la consulta falla,
 * `true`.
 *
 * La instancia que tiene el turno siempre lo puede renovar. La ventana se mide
 * desde que corrió la sentencia, no desde el tick: si un tick esperó una
 * conexión del pool más que la ventana, el siguiente de la misma instancia
 * quedaría bloqueado por su propio turno.
 */
export async function tomarTurnoCron(nombre: string): Promise<boolean> {
  if (!dependencias) return true;
  const ventanaSeg = ventanaDeTurnoMs(nombre) / 1000;
  try {
    // $queryRaw: el upsert con WHERE en el DO UPDATE y RETURNING no tiene equivalente en la API de Prisma.
    const filas = await dependencias.prisma.$queryRaw<{ job_name: string }[]>`
      INSERT INTO cron_turnos (job_name, tomado_at, instancia)
      VALUES (${nombre}, now(), ${INSTANCIA})
      ON CONFLICT (job_name) DO UPDATE
        SET tomado_at = now(), instancia = EXCLUDED.instancia
        WHERE cron_turnos.tomado_at < now() - make_interval(secs => ${ventanaSeg})
          OR cron_turnos.instancia = EXCLUDED.instancia
      RETURNING job_name`;
    return filas.length > 0;
  } catch (error) {
    // Sin turno no se pierde el tick: mejor un posible duplicado que un cron
    // que no corre (y sin base el job fallaría igual).
    logger.warn(
      `${nombre}: no se pudo tomar el turno (${error instanceof Error ? error.message : String(error)}); corre igual`,
    );
    return true;
  }
}

/**
 * Para los `@Cron` que no pasan por `CronRegistryService.wrapExecution`: corre
 * el método solo en la instancia que toma el turno y lo cuenta como trabajo en
 * curso, para que el apagado ordenado lo espere. Respeta `CRONS_ENABLED=false`
 * como los crons del registry. Va debajo del `@Cron`.
 */
export function UnaInstancia(nombre: string): MethodDecorator {
  return (_objetivo, _clave, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (
      ...args: unknown[]
    ) => Promise<unknown>;
    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      // Igual que en CronRegistryService: CRONS_ENABLED=false (el worker de
      // colas) no corre ningún cron, ni compite por el turno con la API.
      if (process.env.CRONS_ENABLED === 'false') return;
      if (!(await tomarTurnoCron(nombre))) {
        logger.debug(`${nombre}: el turno de este tick lo tomó otra instancia`);
        return;
      }
      return enTrabajo(() => original.apply(this, args));
    };
    return descriptor;
  };
}
