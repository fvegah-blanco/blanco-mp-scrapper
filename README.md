# blanco-mp-scrapper

Ingesta de Mercado Público para Blanco: quién le compra a quién, con qué proceso, y los datos de contacto del **deudor** (el organismo comprador) y del **vendedor** (el proveedor adjudicado).

Misma arquitectura que el back office: **NestJS 11 + Prisma 7 + Postgres**, con los crons internos registrados en `CronRegistryService` (copiado de `blanco-backend/apps/backoffice-api/src/cron-management`). Cada cron se puede pausar, disparar a mano o cambiar de horario desde la API o el panel, y deja su historial en `cron_job_runs`.

## Qué hace

| Flujo | Fuente | Cron | Resultado |
|---|---|---|---|
| 1. Descarga masiva por URL | `transparenciachc.blob.core.windows.net/{oc-da,lic-da}/AAAA-M.zip` | `datos-abiertos-sync` (diario 05:00) | Backfill del año en curso, mes a mes; solo reprocesa los meses cuyo **ETag** cambió |
| 2. OC en tiempo real | `api.buscador.mercadopublico.cl/ordenes-de-compra` | `oc-tiempo-real` (cada 30 min) | OC nuevas → ficha → cruce con su licitación o compra ágil en el mismo ciclo |
| 3. Ficha de la OC | `DetailsPurchaseOrder.aspx?codigoOC=` (ASP.NET) | `oc-fichas` (cada 10 min, pendientes) | Contacto del **comprador** y del **proveedor**, licitación de origen |
| 4. Cruce OC ↔ compra ágil | Nombre de la OC + buscador de compra ágil | `compra-agil-match` (cada 15 min, pendientes) | Código COT, cotizaciones (quién ofertó, cuánto, quién ganó) |
| 5. Adjuntos | Licitación: ficha + postback `VerAntecedentes.aspx`. Compra ágil: `adjunto.mercadopublico.cl` | `adjuntos-descarga` (cada 15 min) | Bases, anexos y actas en S3 o disco |
| 6. Texto, OCR y contactos | Los adjuntos descargados | `documentos-extraccion` (cada 10 min) | Texto (PDF, Word, Excel, ZIP; OCR de escaneados e imágenes) y contactos con rol |
| 7. Documentos del adjudicado | Licitación: Cuadro de Ofertas → Anexo N°1 del oferente. Compra ágil: adjuntos de la cotización ganadora | dentro de `adjuntos-descarga` | El formulario donde el vendedor deja su representante legal y su contacto |
| 8. Lectura con Bedrock | Documentos del oferente (no las bases) | `documentos-analisis-ia` (cada 10 min) | Razón social, RUT y contactos del vendedor, aunque el formato varíe o sea un escaneo |

Todo sin navegador: lo que licitamatch hacía con Playwright (anexos de licitación) aquí es un POST con el `__VIEWSTATE` de la página.

## Hallazgos sobre las fuentes (10-11-2026)

- **Archivos masivos.** Un zip por tipo y mes, con `ETag`/`Last-Modified`. El CSV viene en latin1, separado por `;`, montos con coma decimal y `NA` como vacío. El de OC trae una fila por línea (≈136 mil filas y 49 mil OC en noviembre); el de licitaciones una fila por ítem × oferta, con `Oferta seleccionada`. Las licitaciones se agrupan por **mes de publicación**, y ChileCompra regenera los meses anteriores cuando cambia el estado de una licitación. Por eso el sync compara el ETag de cada mes y no solo el del mes en curso.
- **Las OC de compra ágil (AG) no traen el código de la compra ágil** en `CodigoLicitacion`. Pero ~80% lo tiene en el nombre: MP lo escribe solo ("Orden de Compra generada por invitación a compra ágil: 3485-1129-COT26") y muchos compradores lo copian. Para el resto se busca en el buscador de compra ágil (`keywords`), filtrando las de la misma unidad de compra (mismo prefijo: `1196-267-AG26` ↔ `1196-63-COT26`), y se confirma en la ficha (`id_orden_compra` = ID de la OC).
- **La ficha pública de la OC trae el contacto en el `__VIEWSTATE`.** El HTML pinta el correo como imagen ofuscada (`ImgOfuscar.aspx`), pero el ViewState trae en claro el nombre, cargo, teléfono y correo del comprador y, cuando la OC ya fue aceptada, también del proveedor. Si el correo solo está en la imagen, se pasa por OCR. Es la fuente más barata y confiable de contactos (confianza 0,95).
- **El buscador** (`api.buscador.mercadopublico.cl`) usa la api-key pública de su bundle, no tiene cuota diaria, corta a los 29 s y tope de 10.000 resultados por búsqueda. La búsqueda de compra ágil por palabras suele dar 504: se hace con un solo intento y fuera del ciclo de tiempo real.
- **OC de licitación (SE/CC).** La ficha trae el código de la licitación aunque el buscador no lo informe.

## Documentos del vendedor y Bedrock

Idea tomada de `sii_situacion_tributaria` (Seba): **el contacto del vendedor está en el Anexo N°1 / Formulario de identificación del oferente**, y su formato cambia tanto entre organismos que el regex resolvía 1 de 5 y un modelo con visión 5 de 5.

- **Licitación** (`src/mercado-publico/ofertas.client.ts`): Ficha → Cuadro de Ofertas → `OpeningHeader` → `SupplySummary` con el buscador por RUT (la tabla de oferentes pagina) → `ViewBidAttachment` (grilla de a 6, paginada) → se lista todo sin bajar y se descarga solo lo que parece Anexo N°1. Como ya sabemos qué licitación ganó cada proveedor, no se pasa por el portal de Contratos.
- **Compra ágil**: la ficha trae `id_cotizacion` por cotización, y `adjunto.mercadopublico.cl/.../cotizacion/listar/{id}` devuelve los archivos que subió el proveedor (cotización con membrete, patente).
- **Bedrock** (`src/extraccion/analisis-ia.service.ts`): Haiku 4.5 por Converse, igual que el back office. Recibe el texto extraído como fuente fiel y las primeras páginas como imagen, y devuelve JSON con esquema (razón social, RUT, contactos con rol). Si el correo no aparece en el texto, se baja la confianza. Solo pasan los documentos del oferente; con la IA activa, el regex no guarda contactos de esos documentos.
- **Medido**: los 5 Anexos N°1 de ejemplo de Seba (formatos distintos) dieron 5 de 5 con el RUT correcto y 2–4 contactos cada uno, ~3 s por documento. Anexo N°1 real de `799512-11-LE26`: representante, cargo, correo y teléfono del adjudicado.
- **Baneo**: el portal de licitaciones banea por IP pasado cierto volumen. Hay `adjuntos.pausa_ms` entre requests y un 403 corta la corrida (se retoma en la siguiente). Como aquí solo se bajan los adjudicados en tiempo real (no los ~10 mil proveedores de una vez), no debería hacer falta proxy; si se hace un barrido histórico, sí.

## Gasto y tiempos de la IA

Cada documento que pasa por Bedrock guarda tokens de entrada y salida, páginas enviadas como imagen, tiempo de la llamada y costo (`tokens × bedrock.precio_*_usd_mtok`); la extracción de texto/OCR guarda su propio tiempo. La vista **Gasto IA** del panel muestra el total del período, costo y tiempo por documento (mediana y p95), costo por contacto encontrado, gasto por día y el detalle de cada documento. El precio por defecto es el de Haiku 4.5 en la API de Anthropic (US$ 1 / US$ 5 por millón); Bedrock publica su propia tabla, así que la cifra oficial es la factura de AWS. Medido el 10-11: ~US$ 0,006–0,010 y 3–5 s por documento.

## Modelo de datos

| Tabla | Qué guarda |
|---|---|
| `empresas` | Cada RUT visto (normalizado `76573521-1`), con banderas `es_organismo` / `es_proveedor` |
| `procesos` | Licitaciones y compras ágiles (`tipo`, sigla, estado, comprador, fechas, monto) + estado de sus adjuntos |
| `ofertas` | Ítem × proveedor: monto ofertado, adjudicado y `seleccionada` |
| `ordenes_compra` / `orden_compra_items` | OC (ID numérico de MP como PK) y sus líneas; `proceso_codigo` la amarra a su proceso |
| `adjudicaciones` | Quién se adjudicó cada proceso, con la OC que lo materializa y el origen del dato |
| `v_adjudicaciones` (vista) | Adjudicación + enlace al proceso + comprador + proveedor + OC |
| `documentos` | Adjuntos: origen (BASES/OFERTA/COTIZACION), oferente dueño, hash, ruta, texto, método (TEXTO/OCR) y análisis IA |
| `contactos` | Correo/teléfono con `rol` (COMPRADOR = deudor, PROVEEDOR = vendedor), RUT, fuente, evidencia y confianza |
| `archivos_masivos` | Estado de cada mes del backfill (ETag, filas, errores) |
| `configuraciones` | Parámetros vivos y marcas de agua de los crons |
| `cron_job_configs` / `cron_job_runs` / `cron_turnos` | Igual que en el back office |

## Cómo se decide de quién es un contacto en un documento

`src/extraccion/contactos.extractor.ts`, de la señal más fuerte a la más débil:

1. Un **RUT conocido** cerca (el del comprador o el de un oferente del proceso): 0,9.
2. El **dominio del correo** se parece al nombre de una de las partes, o es `.gob.cl`/`.mun.cl`: 0,75.
3. **Palabras de contexto** cerca ("oferente", "representante legal" → proveedor; "unidad requirente", "contraparte técnica" → comprador): 0,45–0,6.

Cada contacto guarda la evidencia (el fragmento de texto) para revisarlo a mano.

## Correr en local

```bash
cp .env.example .env
docker compose up -d db          # Postgres en localhost:5440
npm install
npx prisma migrate deploy
npm run dev                      # http://localhost:4500 (panel) · /docs (Swagger) · /api/...
```

Con `CRONS_ENABLED=false` los crons no corren solos (igual se pueden disparar desde el panel). Para importar un CSV que ya bajaste:

```bash
curl -X POST localhost:4500/api/datos-abiertos/importar-local \
  -H 'content-type: application/json' -d '{"tipo":"OC","ruta":"/Users/felipe/Downloads/2026-11.csv"}'
```

## API (todo bajo `/api`, header `x-admin-key` si `ADMIN_API_KEY` está definida)

- `GET /cron-jobs` · `GET /cron-jobs/:name/runs` · `POST /cron-jobs/:name/trigger` · `PATCH /cron-jobs/:name` (`state`, `schedule`, `timeZone`, `resetSchedule`)
- `GET /configuracion` · `PATCH /configuracion/:clave` (`{"valor": ...}`) · `DELETE /configuracion/:clave`
- `GET /datos-abiertos/estado` · `GET /datos-abiertos/archivos` · `POST /datos-abiertos/archivos/:tipo/:anio/:mes[?forzar=true]` · `POST /datos-abiertos/importar-local`
- `POST /tiempo-real/ordenes/:codigo/cruzar`
- `POST /documentos/encolar` · `POST /documentos/procesos/:codigo/descargar` · `POST /documentos/:id/extraer` · `POST /documentos/:id/analizar-ia` · `POST /documentos/procesos/:codigo/reanalizar`
- `POST /tiempo-real/compras-agiles/:codigo/ficha`
- `GET /consultas/ia?dias=30` (gasto y tiempos de la IA) · `GET /consultas/resumen` · `GET /consultas/adjudicaciones` · `GET /consultas/empresas/:rut` · `GET /consultas/procesos/:codigo` · `GET /consultas/contactos`

## Parámetros vivos (los principales)

| Clave | Defecto | Para qué |
|---|---|---|
| `datos_abiertos.anio_desde` | año en curso | Desde qué año se mantiene el backfill |
| `datos_abiertos.guardar_items_oc` | true | Guardar las líneas de cada OC |
| `tiempo_real.solape_minutos` | 90 | Cuánto hacia atrás vuelve a mirar el poll |
| `adjuntos.auto_encolar_adjudicados` | true | Bajar los adjuntos de todo proceso adjudicado **en tiempo real** (el backfill no encola) |
| `match_compra_agil.busqueda_por_palabras` | true | Respaldo por buscador cuando la OC no trae el COT |
| `extraccion.ocr_max_paginas` | 15 | Páginas de un escaneado que pasan por OCR |
| `adjuntos.documentos_adjudicado` | true | Bajar el Anexo N°1 / cotización del adjudicado |
| `adjuntos.pausa_ms` | 400 | Pausa entre requests al portal (anti-baneo) |
| `bedrock.habilitado` / `bedrock.lote` | true / 20 | Lectura con IA y tope por corrida (costo) |
| `match_compra_agil.presupuesto_segundos` | 240 | Tiempo máximo por corrida para el cruce por palabras |

La lista completa está en `src/configuracion/parametros.ts` y en la pestaña Parámetros del panel.

## Medido en local (10-11-2026)

- Licitaciones octubre: 102.626 filas en 66 s. OC noviembre: 135.885 filas en 90 s. Cero filas con error.
- 16.706 de 21.241 OC AG de noviembre se cruzan con su compra ágil solo por el nombre.
- Un poll de tiempo real: 974 OC vistas, 65 nuevas, 65 fichas leídas (51 contactos), 28 compras ágiles completadas, en ~6 min.
- Adjuntos: licitación `799512-11-LE26` (7 anexos .docx) en 7 s; compra ágil `3134-107-COT26` (3 PDF) en 0,7 s. OCR de un certificado escaneado (JBIG2) correcto.

## Pendiente / siguientes pasos

- **Paginación de la página de anexos.** Una licitación con muchos anexos puede paginar la grilla; hoy se lee la primera página de cada `VerAntecedentes`.
- **SII**: el proyecto de Seba también enriquece cada RUT con su situación tributaria (zeus.sii.cl). Se puede sumar como otro cron sobre `empresas`.
- **Reintento de documentos con error de IA**: hoy quedan en `ERROR`; se reprocesan con `POST /documentos/:id/analizar-ia`.
- **Panel en el back office.** El panel estático (`public/index.html`) cubre la administración; si se integra a `backoffice-fe`, la API ya tiene el mismo contrato de `/cron-jobs`.
