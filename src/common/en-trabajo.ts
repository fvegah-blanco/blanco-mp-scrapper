/**
 * Trabajo en curso del proceso. `enableShutdownHooks` + `esperarTrabajoEnCurso`
 * dejan que un redeploy espere a que termine el cron que está corriendo, igual
 * que el apagado ordenado del back office (versión mínima).
 */
let enCurso = 0;

export async function enTrabajo<T>(fn: () => Promise<T>): Promise<T> {
  enCurso++;
  try {
    return await fn();
  } finally {
    enCurso--;
  }
}

export async function esperarTrabajoEnCurso(maxMs: number): Promise<void> {
  const limite = Date.now() + maxMs;
  while (enCurso > 0 && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 500));
  }
}
