# Crons

Registrados en `CronRegistryService` (el del back office). Cada uno se puede pausar, disparar a mano o cambiar de horario desde el panel o la [API de crons](../api/cron-jobs.md), y deja su historial en `cron_job_runs`. Relacionado: [flujo de ingesta](../flows/ingesta.md), [parámetros](../configuracion.md).

| Cron | Horario por defecto | Qué hace | Parámetros principales |
|---|---|---|---|
| `datos-abiertos-sync` | `0 5 * * *` (America/Santiago) | Carga los `.zip` mensuales cuyo ETag cambió | `datos_abiertos.*` |
| `oc-tiempo-real` | `*/30 * * * *` | Trae las OC nuevas, lee su ficha y las cruza con su proceso | `tiempo_real.*` |
| `oc-fichas` | `2-59/10 * * * *` | Lee las fichas de OC pendientes | `fichas_oc.*` |
| `compra-agil-match` | `7-59/15 * * * *` | Cruza las OC de compra ágil con su COT y lee las fichas de compra ágil | `match_compra_agil.*`, `compras_agiles.*` |
| `adjuntos-descarga` | `*/15 * * * *` | Baja los adjuntos de los procesos encolados | `adjuntos.*` |
| `documentos-extraccion` | `5-59/10 * * * *` | Extrae texto (u OCR) y busca contactos | `extraccion.*` |
| `documentos-analisis-ia` | `8-59/10 * * * *` | Lee con Bedrock los documentos del proveedor | `bedrock.*` |

## Comportamiento

- `CRONS_ENABLED=false` impide que corran solos; igual se pueden disparar a mano. Vacío, decide la tabla `cron_job_configs`.
- Con dos instancias (un despliegue en curso) un turno en `cron_turnos` evita que el mismo cron corra dos veces.
- Al recibir `SIGTERM` la app espera hasta 2 minutos a que termine el cron en curso.
- Un cron que ya está corriendo no se puede disparar de nuevo: la API responde 409.
