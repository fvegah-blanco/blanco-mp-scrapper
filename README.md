# blanco-mp-scrapper

Ingesta de Mercado Público para Blanco. Responde tres preguntas sobre cada compra del Estado:

1. **Quién le compra a quién**: organismo comprador (el deudor de la factura) y proveedor adjudicado (el vendedor, cliente potencial de factoring).
2. **Con qué proceso**: la licitación o compra ágil y la orden de compra que la materializa.
3. **Cómo contactarlos**: nombre, cargo, correo y teléfono de ambos, con la evidencia de dónde salió cada dato.

## Stack

NestJS 11 (Node 22) · Prisma 7 · Postgres 16 · crons administrables (el `CronRegistryService` del back office) · pdf.js y Tesseract para texto y OCR · Bedrock (Luna, con Haiku 4.5 de respaldo) · panel estático en `/` con el diseño del back office.

## De dónde sale cada dato y para qué

| Fuente | Qué se obtiene | Para qué |
|---|---|---|
| Datos abiertos de ChileCompra (un `.zip` por mes) | Órdenes de compra, licitaciones, ofertas y adjudicaciones | Base histórica: quién compró, quién ofertó y quién ganó |
| Buscador de Mercado Público | OC nuevas cada 30 minutos; ficha de cada compra ágil | Detectar adjudicaciones el mismo día, no al mes siguiente |
| Ficha pública de la OC | Contacto del comprador y del proveedor; licitación de origen | Es el contacto más confiable (0,95) y el más barato de obtener |
| Adjuntos del proceso | Bases, anexos, actas; Anexo N°1 del adjudicado; cotización ganadora | El contacto del vendedor está en los documentos que él mismo subió |
| Bedrock sobre esos documentos | Razón social, RUT, representante legal y contactos | El formato del Anexo N°1 cambia entre organismos; el regex no alcanza |

Detalle de cada fuente y sus particularidades: [docs/fuentes.md](docs/fuentes.md).

## Correr en local

Todo en contenedores (OrbStack o Docker). Los crons quedan apagados y las credenciales de Bedrock se pasan desde el entorno, no se copian al repo:

```bash
BEDROCK_AWS_ACCESS_KEY_ID=... BEDROCK_AWS_SECRET_ACCESS_KEY=... docker compose up -d --build
```

O con la app en el host:

```bash
cp .env.example .env
docker compose up -d db
npm install
npx prisma migrate deploy
npm run dev
```

| Dirección | Qué hay |
|---|---|
| http://localhost:4500 | Panel: resumen, adjudicaciones, contactos, gasto IA, crons y parámetros |
| http://localhost:4500/docs | Swagger de la API |
| http://localhost:4500/api | API (`x-admin-key` si `ADMIN_API_KEY` está definida) |

## Ejemplos de uso

```bash
API=http://localhost:4500/api

# Traer las OC nuevas ahora, sin esperar al cron
curl -X POST $API/cron-jobs/oc-tiempo-real/trigger

# Cargar un mes de datos abiertos (órdenes de compra de noviembre de 2026)
curl -X POST $API/datos-abiertos/archivos/OC/2026/11

# Bajar los adjuntos de un proceso y ver qué se obtuvo
curl -X POST $API/documentos/procesos/799512-11-LE26/descargar
curl $API/consultas/procesos/799512-11-LE26

# Contactos de proveedores con confianza de 90% o más
curl "$API/consultas/contactos?rol=PROVEEDOR&minConfianza=0.9&limit=20"

# Todo lo que se sabe de un RUT: contactos, adjudicaciones y compras
curl $API/consultas/empresas/76123456-7

# Adjudicaciones de compra ágil detectadas desde una fecha
curl "$API/consultas/adjudicaciones?tipo=COMPRA_AGIL&desde=2026-11-01"

# Cambiar un parámetro vivo (documentos por corrida que van a Bedrock)
curl -X PATCH $API/configuracion/bedrock.lote -H 'content-type: application/json' -d '{"valor": 50}'
```

Todas las respuestas tienen la forma `{ "success": true, "data": ... }`; los listados suman `total`, `page` y `limit`.

## Documentación

| Documento | Contenido |
|---|---|
| [docs/README.md](docs/README.md) | Índice |
| [docs/fuentes.md](docs/fuentes.md) | Fuentes de Mercado Público y lo aprendido de cada una |
| [docs/flows/ingesta.md](docs/flows/ingesta.md) | Flujo completo, de la OC al contacto |
| [docs/flows/contactos.md](docs/flows/contactos.md) | Cómo se decide de quién es un contacto; reglas de la IA |
| [docs/jobs/crons.md](docs/jobs/crons.md) | Los siete crons |
| [docs/api/README.md](docs/api/README.md) | API: convenciones y endpoints |
| [docs/models/modelo-de-datos.md](docs/models/modelo-de-datos.md) | Tablas y relaciones |
| [docs/configuracion.md](docs/configuracion.md) | Variables de entorno y parámetros vivos |
| [docs/seguridad.md](docs/seguridad.md) | Controles de seguridad |
| [docs/despliegue.md](docs/despliegue.md) | Qué se necesita en producción |
| [docs/GAP-ANALYSIS.md](docs/GAP-ANALYSIS.md) | Brechas y pendientes |

## Desarrollo

```bash
npm run typecheck   # tipos
npm test            # pruebas unitarias
```

Reglas de interfaz y de API para quien modifique el proyecto: [CLAUDE.md](CLAUDE.md).
