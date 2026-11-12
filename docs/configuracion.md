# Configuración

Dos niveles: variables de entorno (se fijan al desplegar) y parámetros vivos (se cambian desde el panel o la [API](api/configuracion.md) y se aplican en la próxima ejecución). Relacionado: [despliegue](despliegue.md), [seguridad](seguridad.md).

## Variables de entorno

| Variable | Requerida | Default | Para qué |
|---|---|---|---|
| `DATABASE_URL` | sí | | Conexión a Postgres |
| `ADMIN_API_KEY` | en producción | vacío | Llave del header `x-admin-key`. Con `NODE_ENV=production` la app no arranca sin ella |
| `NODE_ENV` | no | | `production` exige la llave, oculta Swagger y escribe logs en JSON |
| `PORT` | no | 4500 | Puerto HTTP |
| `CRONS_ENABLED` | no | vacío | `true` o `false` fuerza todos los crons; vacío decide `cron_job_configs` |
| `DOCS_ENABLED` | no | vacío | `true` publica Swagger en producción |
| `LOG_LEVEL` | no | `info` | Nivel de log |
| `DB_POOL_MAX` | no | 10 | Conexiones del pool |
| `STORAGE_DIR` | no | `./storage` | Carpeta de adjuntos cuando no hay S3 |
| `S3_BUCKET`, `S3_PREFIX`, `AWS_REGION` | no | vacío, `mp-scrapper`, `us-east-1` | Con `S3_BUCKET` los adjuntos van a S3 |
| `TMP_DIR` | no | `./tmp` | Zip de datos abiertos, CSV a importar e idiomas del OCR |
| `OCR_LANGS` | no | `spa+eng` | Idiomas de Tesseract |
| `MP_BUSCADOR_API_KEY`, `MP_ADJUNTOS_USER_KEY` | no | las públicas | Llaves que el sitio de Mercado Público incrusta en su JavaScript; no son secretas |
| `BEDROCK_AWS_ACCESS_KEY_ID`, `BEDROCK_AWS_SECRET_ACCESS_KEY` | para la IA | | Credenciales de Bedrock |
| `BEDROCK_AWS_REGION` | no | `us-east-2` | Región de Bedrock |
| `BEDROCK_USE_DEFAULT_CREDENTIALS` | no | `false` | `true` usa el rol de la instancia en vez de llaves |
| `BEDROCK_MODEL` | no | `openai.gpt-5.6-luna` | Modelo principal |
| `BEDROCK_MODEL_RESPALDO` | no | Haiku 4.5 | Modelo que responde si falla el principal |

## Parámetros vivos

Definidos en `src/configuracion/parametros.ts`.

| Clave | Default | Para qué |
|---|---|---|
| `datos_abiertos.anio_desde` | 2026 | Primer año que mantiene al día el sync masivo (backfill mínimo: el año en curso). |
| `datos_abiertos.guardar_items_oc` | true | Guarda las líneas de cada OC (orden_compra_items). Apagar si la base crece demasiado. |
| `datos_abiertos.lote_filas` | 1000 | Filas del CSV por upsert. |
| `tiempo_real.solape_minutos` | 90 | Cuánto hacia atrás vuelve a mirar el poll de OC respecto de la última OC vista. |
| `tiempo_real.max_paginas` | 100 | Tope de páginas (20 OC c/u) por corrida del poll de OC. |
| `match_compra_agil.lote` | 300 | OC de compra ágil sin proceso que se intentan cruzar por corrida. |
| `match_compra_agil.busqueda_por_palabras` | true | Si la OC no trae el COT en el nombre, buscarlo en el buscador por palabras (lento: ~1 búsqueda por OC). |
| `match_compra_agil.lote_busquedas` | 10 | Tope de búsquedas por palabras por corrida (el buscador corta a los 29 s). |
| `match_compra_agil.presupuesto_segundos` | 240 | Tiempo máximo por corrida para las búsquedas por palabras (el buscador responde lento o con 504). |
| `compras_agiles.lote_fichas` | 60 | Fichas de compra ágil que se leen por corrida (cotizaciones: quién ofertó, por cuánto y quién ganó). |
| `match_compra_agil.max_intentos` | 4 | Intentos antes de dejar de buscar la compra ágil de una OC. |
| `match_compra_agil.dias_atras` | 20 | Ventana de publicación (días antes del envío de la OC) donde se busca la compra ágil. |
| `fichas_oc.lote` | 80 | Fichas públicas de OC que se leen por corrida (contacto del comprador, licitación de origen). |
| `fichas_oc.solo_tiempo_real` | true | Leer fichas solo de OC llegadas por el poll en tiempo real (no del backfill masivo). |
| `adjuntos.auto_encolar_adjudicados` | true | Encola la descarga de adjuntos de todo proceso adjudicado detectado en tiempo real. |
| `adjuntos.lote_procesos` | 10 | Procesos cuyos adjuntos se bajan por corrida. |
| `adjuntos.max_archivos_por_proceso` | 60 | Tope de adjuntos por proceso. |
| `adjuntos.max_mb_por_archivo` | 40 | Adjuntos más grandes se registran como OMITIDO. |
| `adjuntos.max_intentos` | 3 | Intentos de descarga de un proceso antes de dejarlo en ERROR. |
| `adjuntos.documentos_adjudicado` | true | Bajar también los documentos del proveedor adjudicado: Anexo N°1 del cuadro de ofertas (licitación) o adjuntos de su cotización (compra ágil). |
| `adjuntos.oferta_solo_anexo1` | true | En licitaciones, del oferente bajar solo el Anexo N°1 (si no se reconoce, los primeros PDF administrativos). |
| `adjuntos.oferta_max_administrativos` | 3 | PDF administrativos que se bajan cuando el oferente no tiene un archivo que parezca Anexo N°1. |
| `adjuntos.pausa_ms` | 400 | Pausa entre requests al portal de licitaciones (banea por IP pasado cierto volumen). |
| `bedrock.habilitado` | true | Analizar con Bedrock los documentos del oferente (Anexo N°1 y cotizaciones). Sin credenciales BEDROCK_AWS_* no corre. |
| `bedrock.lote` | 20 | Documentos que se mandan a Bedrock por corrida (control de costo). |
| `bedrock.max_paginas` | 4 | Páginas de cada PDF que se mandan como imagen al modelo (el Anexo N°1 rara vez pasa de 2). |
| `bedrock.max_contactos_documento` | 6 | Si un documento del proveedor trae más personas que esto, es una lista de referencias (clientes, experiencia): solo se guarda el representante legal. |
| `bedrock.precio_entrada_usd_mtok` | 0.22 | USD por millón de tokens de entrada del modelo principal (BEDROCK_MODEL; Luna: 0,22). Confirmar contra la tabla de Bedrock: es el que usa el costo por documento. |
| `bedrock.precio_salida_usd_mtok` | 1.32 | USD por millón de tokens de salida del modelo principal (Luna: 1,32; incluye los de razonamiento). |
| `bedrock.precio_respaldo_entrada_usd_mtok` | 1 | USD por millón de tokens de entrada del modelo de respaldo (BEDROCK_MODEL_RESPALDO; Haiku 4.5: 1), usado si falla el principal. |
| `bedrock.precio_respaldo_salida_usd_mtok` | 5 | USD por millón de tokens de salida del modelo de respaldo (Haiku 4.5: 5). |
| `ia.dolar_clp` | 950 | Pesos por dólar para mostrar el gasto en CLP (referencial). |
| `extraccion.lote` | 15 | Documentos que se pasan por texto/OCR por corrida. |
| `extraccion.ocr_max_paginas` | 15 | Páginas de un PDF escaneado que se pasan por OCR. |
| `extraccion.texto_max_chars` | 300000 | Largo máximo del texto guardado por documento. |
