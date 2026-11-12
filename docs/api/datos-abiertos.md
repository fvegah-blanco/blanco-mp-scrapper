# API: datos abiertos

Carga masiva de los `.zip` mensuales. Convenciones: [README](README.md). Fuente: [fuentes.md](../fuentes.md#datos-abiertos).

### `GET /api/datos-abiertos/estado`

Plan del backfill: un registro por tipo y mes, con su estado (`FALTA`, `PENDIENTE`, `DESCARGANDO`, `PROCESANDO`, `OK`, `ERROR`).

**Ejemplo de respuesta:**
```json
{
  "success": true,
  "data": [{
    "tipo": "LIC", "anio": 2026, "mes": 1,
    "url": "https://transparenciachc.blob.core.windows.net/lic-da/2026-1.zip",
    "estado": "OK", "filasLeidas": 118536, "filasError": 0,
    "terminadoAt": "2026-11-10T17:48:32.151Z", "error": null
  }]
}
```

### `GET /api/datos-abiertos/archivos`

Archivos ya procesados, con ETag, tamaño, filas y tiempos.

| Param | Tipo | Requerido | Descripción |
|---|---|---|---|
| anio | int | no | Filtra por año |

### `POST /api/datos-abiertos/archivos/:tipo/:anio/:mes`

Procesa un mes en segundo plano.

| Param | Tipo | Requerido | Descripción |
|---|---|---|---|
| tipo | `OC` \| `LIC` (ruta) | sí | Órdenes de compra o licitaciones |
| anio | int (ruta) | sí | Entre 2007 y el año en curso |
| mes | int (ruta) | sí | 1 a 12 |
| forzar | bool | no | `true` reprocesa aunque el ETag no haya cambiado |

| Código | Descripción |
|---|---|
| 202 | Aceptado; seguir el avance en `GET /datos-abiertos/archivos` |
| 400 | Tipo, año o mes inválido |

### `POST /api/datos-abiertos/importar-local`

Importa en segundo plano un CSV que ya está en `TMP_DIR` del servidor.

| Param | Tipo | Requerido | Descripción |
|---|---|---|---|
| tipo | `OC` \| `LIC` | sí | Tipo de archivo |
| ruta | string | sí | Nombre o ruta relativa a `TMP_DIR`, terminada en `.csv` |

| Código | Descripción |
|---|---|
| 202 | Aceptado |
| 400 | No es `.csv` o queda fuera de `TMP_DIR` |
