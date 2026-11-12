# Despliegue

Hoy corre solo en local. Esto es lo que se necesita para producción. Relacionado: [configuración](configuracion.md), [seguridad](seguridad.md).

## Imagen

`Dockerfile` multi-etapa sobre `node:22-slim` (Debian, por los binarios de `@napi-rs/canvas`). Corre como usuario `node`, aplica las migraciones al arrancar y escucha en el 4500. Salud: `GET /api/health`.

## Requisitos

| Recurso | Detalle |
|---|---|
| Cómputo | 1 a 2 vCPU y 2 GB de RAM; el OCR es lo que más CPU usa |
| Postgres 16 | Base propia. 4,1 GB con 2026 cargado; crece unos 400 MB por mes |
| Almacenamiento de adjuntos | S3 (`S3_BUCKET`, `S3_PREFIX`) con permiso de lectura y escritura sobre el prefijo |
| Disco temporal | 1 GB en `TMP_DIR` para los zip mensuales y los idiomas del OCR |
| Bedrock | Acceso a Luna y a Haiku 4.5 en `us-east-2`, por llaves o por rol |
| Red de salida | Hacia `mercadopublico.cl`, `transparenciachc.blob.core.windows.net` y Bedrock |

## Variables mínimas

```bash
NODE_ENV=production
DATABASE_URL=postgresql://...
ADMIN_API_KEY=<llave larga y aleatoria>
S3_BUCKET=<bucket>
BEDROCK_AWS_ACCESS_KEY_ID=...        # o BEDROCK_USE_DEFAULT_CREDENTIALS=true
BEDROCK_AWS_SECRET_ACCESS_KEY=...
```

## Pasos

1. Crear la base y el prefijo en S3.
2. Cargar las variables en el orquestador.
3. Desplegar la imagen con los crons pausados (`CRONS_ENABLED=false`).
4. Verificar `GET /api/health` y el panel.
5. Cargar los meses de datos abiertos que se quieran desde el panel.
6. Activar los crons uno a uno y revisar su historial.

## Operación

- **Redeploy.** La app espera hasta 2 minutos al cron en curso antes de cerrar; el turno en `cron_turnos` evita ejecuciones dobles durante el reemplazo.
- **Logs.** JSON por salida estándar (pino), listos para Loki.
- **Costo de IA.** Vista Gasto IA del panel; conviene una alerta de presupuesto en AWS.
- **Bloqueo del portal.** Si aparecen 403 repetidos en `adjuntos-descarga`, subir `adjuntos.pausa_ms` o bajar `adjuntos.lote_procesos`.

## Local

Ver [README del proyecto](../README.md#correr-en-local). El compose corre con `NODE_ENV=development`, crons apagados y `./storage` y `./tmp` montados.
