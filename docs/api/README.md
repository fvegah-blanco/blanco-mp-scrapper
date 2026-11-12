# API

Base: `/api`. Swagger en `/docs` (en producción solo con `DOCS_ENABLED=true`). Relacionado: [seguridad](../seguridad.md).

| Recurso | Documento | Para qué |
|---|---|---|
| `/cron-jobs` | [cron-jobs.md](cron-jobs.md) | Administrar los crons |
| `/configuracion` | [configuracion.md](configuracion.md) | Parámetros vivos |
| `/datos-abiertos` | [datos-abiertos.md](datos-abiertos.md) | Carga masiva mensual |
| `/tiempo-real` | [tiempo-real.md](tiempo-real.md) | Acciones puntuales sobre una OC o compra ágil |
| `/documentos` | [documentos.md](documentos.md) | Acciones puntuales sobre adjuntos |
| `/consultas` | [consultas.md](consultas.md) | Lectura de lo ingerido |
| `/health` | Sin llave | `{ "success": true, "data": { "ok": true } }` si la app y la base responden |

## Convenciones

**Autenticación.** Header `x-admin-key` con el valor de `ADMIN_API_KEY`. Fuera de producción, sin llave configurada, la API queda abierta. El header opcional `x-admin-user` se guarda como autor de los cambios.

**Respuesta correcta.**

```json
{ "success": true, "data": { } }
```

Los listados paginados agregan `total`, `page` y `limit` (`page` desde 1; `limit` hasta 200, 50 por defecto). Las acciones que siguen en segundo plano responden 202 con `message` en vez de `data`.

**Errores.** Formato estándar de NestJS:

```json
{ "statusCode": 400, "message": ["rol must be one of the following values: COMPRADOR, PROVEEDOR, DESCONOCIDO"], "error": "Bad Request" }
```

| Código | Cuándo |
|---|---|
| 200 | Lectura o acción terminada |
| 202 | Acción aceptada que sigue en segundo plano |
| 400 | Parámetro, cuerpo o código inválido |
| 401 | `x-admin-key` ausente o incorrecta |
| 404 | El registro no existe |
| 409 | El cron ya está corriendo |
| 503 | Producción sin `ADMIN_API_KEY` configurada |

**Formatos.**

| Dato | Formato | Ejemplo |
|---|---|---|
| Código de proceso u OC | `número-número-sigla`, se normaliza a mayúsculas | `799512-11-LE26`, `1196-63-COT26` |
| RUT | Con o sin puntos; se normaliza | `76123456-7` |
| ID de documento | UUID | `0b4476c4-46ad-4834-8229-cafb6ee95c5c` |
| ID de OC | Entero grande, serializado como texto | `"55825142"` |
| Fechas | ISO 8601 | `2026-11-01` |
