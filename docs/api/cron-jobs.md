# API: crons

Mismo contrato que `/cron-jobs` del back office. Convenciones: [README](README.md). Lista de crons: [jobs/crons.md](../jobs/crons.md).

### `GET /api/cron-jobs`

Lista los crons con su horario, estado y última ejecución.

**Ejemplo de respuesta:**
```json
{
  "success": true,
  "data": [{
    "name": "datos-abiertos-sync",
    "description": "Descarga masiva por URL...",
    "state": "active",
    "defaultSchedule": "0 5 * * *",
    "activeSchedule": "0 5 * * *",
    "scheduleOverride": null,
    "activeTimeZone": "America/Santiago",
    "nextRun": "2026-11-13T05:00:00.000-03:00",
    "lastRun": { "status": "SUCCESS", "startedAt": "2026-11-10T19:03:23.634Z", "durationMs": 4862095 }
  }]
}
```

### `GET /api/cron-jobs/:name/runs`

Historial de ejecuciones, de la más reciente a la más antigua.

| Param | Tipo | Requerido | Descripción |
|---|---|---|---|
| name | string (ruta) | sí | Nombre del cron |
| page | int | no | Default: 1 |
| limit | int | no | Default: 20, máximo 100 |

| Código | Descripción |
|---|---|
| 200 | `data` con las ejecuciones, más `total`, `page`, `limit`, `totalPages` |
| 404 | El cron no existe |

### `POST /api/cron-jobs/:name/trigger`

Dispara el cron sin esperar a que termine.

| Código | Descripción |
|---|---|
| 202 | Disparado; el resultado queda en el historial |
| 404 | El cron no existe |
| 409 | Ya está corriendo |

### `PATCH /api/cron-jobs/:name`

Pausa, reanuda o cambia el horario.

| Param | Tipo | Requerido | Descripción |
|---|---|---|---|
| state | `active` \| `paused` | no | Reanuda o pausa |
| schedule | string | no | Expresión cron, por ejemplo `*/10 * * * *` |
| timeZone | string | no | Zona IANA, por ejemplo `America/Santiago` |
| resetSchedule | bool | no | Vuelve al horario del código; no se combina con `schedule` |

| Código | Descripción |
|---|---|
| 200 | `data` con el cron actualizado |
| 400 | Expresión inválida, o `schedule` junto con `resetSchedule` |
| 404 | El cron no existe |
