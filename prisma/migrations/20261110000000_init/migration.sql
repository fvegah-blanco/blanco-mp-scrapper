-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tipo_proceso" AS ENUM ('LICITACION_PUBLICA', 'LICITACION_PRIVADA', 'COMPRA_AGIL', 'CONVENIO_MARCO', 'TRATO_DIRECTO', 'OTRO');

-- CreateEnum
CREATE TYPE "fuente_dato" AS ENUM ('DATOS_ABIERTOS', 'BUSCADOR', 'FICHA');

-- CreateEnum
CREATE TYPE "estado_adjuntos" AS ENUM ('NO_SOLICITADO', 'PENDIENTE', 'OK', 'ERROR');

-- CreateEnum
CREATE TYPE "origen_adjudicacion" AS ENUM ('OFERTA_SELECCIONADA', 'ORDEN_COMPRA', 'FICHA_COMPRA_AGIL');

-- CreateEnum
CREATE TYPE "estado_documento" AS ENUM ('PENDIENTE', 'DESCARGADO', 'OMITIDO', 'ERROR');

-- CreateEnum
CREATE TYPE "estado_extraccion" AS ENUM ('PENDIENTE', 'OK', 'SIN_TEXTO', 'ERROR');

-- CreateEnum
CREATE TYPE "metodo_extraccion" AS ENUM ('TEXTO', 'OCR', 'NINGUNO');

-- CreateEnum
CREATE TYPE "rol_contacto" AS ENUM ('COMPRADOR', 'PROVEEDOR', 'DESCONOCIDO');

-- CreateEnum
CREATE TYPE "fuente_contacto" AS ENUM ('FICHA_OC', 'FICHA_LICITACION', 'DOCUMENTO');

-- CreateEnum
CREATE TYPE "tipo_reporte" AS ENUM ('OC', 'LIC');

-- CreateEnum
CREATE TYPE "estado_archivo" AS ENUM ('PENDIENTE', 'DESCARGANDO', 'PROCESANDO', 'OK', 'ERROR');

-- CreateEnum
CREATE TYPE "cron_job_run_status" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "cron_job_trigger_type" AS ENUM ('CRON', 'MANUAL');

-- CreateTable
CREATE TABLE "empresas" (
    "rut" TEXT NOT NULL,
    "razon_social" TEXT,
    "es_organismo" BOOLEAN NOT NULL DEFAULT false,
    "es_proveedor" BOOLEAN NOT NULL DEFAULT false,
    "codigo_organismo" TEXT,
    "codigo_proveedor" TEXT,
    "sector" TEXT,
    "actividad" TEXT,
    "comuna" TEXT,
    "region" TEXT,
    "primera_vez_vista" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultima_vez_vista" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("rut")
);

-- CreateTable
CREATE TABLE "procesos" (
    "codigo" TEXT NOT NULL,
    "tipo" "tipo_proceso" NOT NULL,
    "codigo_tipo" TEXT,
    "id_mp" BIGINT,
    "nombre" TEXT,
    "descripcion" TEXT,
    "link" TEXT,
    "estado" TEXT,
    "comprador_rut" TEXT,
    "codigo_organismo" TEXT,
    "organismo" TEXT,
    "unidad" TEXT,
    "region" TEXT,
    "fecha_publicacion" TIMESTAMPTZ(6),
    "fecha_cierre" TIMESTAMPTZ(6),
    "fecha_adjudicacion" TIMESTAMPTZ(6),
    "monto_estimado" DECIMAL(20,2),
    "moneda" TEXT,
    "numero_oferentes" INTEGER,
    "fuente" "fuente_dato" NOT NULL,
    "adjuntos_estado" "estado_adjuntos" NOT NULL DEFAULT 'NO_SOLICITADO',
    "adjuntos_intentos" INTEGER NOT NULL DEFAULT 0,
    "adjuntos_error" TEXT,
    "adjuntos_revisado_at" TIMESTAMPTZ(6),
    "detalle_revisado_at" TIMESTAMPTZ(6),
    "detalle_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procesos_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "ofertas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "proceso_codigo" TEXT NOT NULL,
    "codigo_item" TEXT NOT NULL,
    "correlativo" INTEGER,
    "producto" TEXT,
    "proveedor_rut" TEXT NOT NULL,
    "nombre_oferta" TEXT,
    "estado_oferta" TEXT,
    "cantidad_ofertada" DECIMAL(20,4),
    "monto_unitario" DECIMAL(20,4),
    "valor_total" DECIMAL(20,2),
    "cantidad_adjudicada" DECIMAL(20,4),
    "monto_adjudicado" DECIMAL(20,2),
    "seleccionada" BOOLEAN NOT NULL DEFAULT false,
    "fecha_envio" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ofertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordenes_compra" (
    "id" BIGINT NOT NULL,
    "codigo" TEXT NOT NULL,
    "link" TEXT,
    "nombre" TEXT,
    "descripcion" TEXT,
    "tipo" TEXT,
    "procedencia" TEXT,
    "es_compra_agil" BOOLEAN NOT NULL DEFAULT false,
    "es_trato_directo" BOOLEAN NOT NULL DEFAULT false,
    "estado" TEXT,
    "estado_proveedor" TEXT,
    "fecha_creacion" TIMESTAMPTZ(6),
    "fecha_envio" TIMESTAMPTZ(6),
    "fecha_aceptacion" TIMESTAMPTZ(6),
    "fecha_cancelacion" TIMESTAMPTZ(6),
    "monto_total" DECIMAL(20,2),
    "moneda" TEXT,
    "monto_total_clp" DECIMAL(20,2),
    "comprador_rut" TEXT,
    "unidad_compra" TEXT,
    "codigo_unidad_compra" TEXT,
    "organismo" TEXT,
    "codigo_organismo" TEXT,
    "proveedor_rut" TEXT,
    "proveedor_nombre" TEXT,
    "codigo_proveedor" TEXT,
    "proceso_codigo" TEXT,
    "convenio_marco" TEXT,
    "forma_pago" TEXT,
    "fuente" "fuente_dato" NOT NULL,
    "ficha_revisada_at" TIMESTAMPTZ(6),
    "ficha_error" TEXT,
    "match_intentado_at" TIMESTAMPTZ(6),
    "match_intentos" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ordenes_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orden_compra_items" (
    "id" BIGINT NOT NULL,
    "orden_compra_id" BIGINT NOT NULL,
    "codigo_producto_onu" TEXT,
    "producto" TEXT,
    "rubro" TEXT,
    "especificacion_comprador" TEXT,
    "especificacion_proveedor" TEXT,
    "cantidad" DECIMAL(20,4),
    "unidad_medida" TEXT,
    "precio_neto" DECIMAL(20,4),
    "total_linea_neto" DECIMAL(20,2),

    CONSTRAINT "orden_compra_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjudicaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clave" TEXT NOT NULL,
    "proceso_codigo" TEXT NOT NULL,
    "proveedor_rut" TEXT NOT NULL,
    "orden_compra_id" BIGINT,
    "monto" DECIMAL(20,2),
    "origen" "origen_adjudicacion" NOT NULL,
    "detectada_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjudicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "proceso_codigo" TEXT NOT NULL,
    "id_externo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo_anexo" TEXT,
    "mime" TEXT,
    "tamano_bytes" INTEGER,
    "sha256" TEXT,
    "ruta_almacen" TEXT,
    "estado" "estado_documento" NOT NULL DEFAULT 'PENDIENTE',
    "error" TEXT,
    "descargado_at" TIMESTAMPTZ(6),
    "extraccion_estado" "estado_extraccion" NOT NULL DEFAULT 'PENDIENTE',
    "metodo_extraccion" "metodo_extraccion",
    "texto" TEXT,
    "extraido_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contactos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clave" TEXT NOT NULL,
    "rut" TEXT,
    "rol" "rol_contacto" NOT NULL,
    "nombre" TEXT,
    "cargo" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "fuente" "fuente_contacto" NOT NULL,
    "proceso_codigo" TEXT,
    "orden_compra_id" BIGINT,
    "documento_id" UUID,
    "evidencia" TEXT,
    "confianza" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "veces_visto" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultima_vez_visto" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contactos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archivos_masivos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" "tipo_reporte" NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "etag" TEXT,
    "last_modified" TIMESTAMPTZ(6),
    "tamano_bytes" BIGINT,
    "estado" "estado_archivo" NOT NULL DEFAULT 'PENDIENTE',
    "filas_leidas" INTEGER NOT NULL DEFAULT 0,
    "filas_error" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "iniciado_at" TIMESTAMPTZ(6),
    "terminado_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archivos_masivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuraciones" (
    "clave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "descripcion" TEXT,
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuraciones_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "cron_job_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_name" TEXT NOT NULL,
    "run_id" UUID NOT NULL,
    "status" "cron_job_run_status" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "items_processed" INTEGER NOT NULL DEFAULT 0,
    "items_failed" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "metadata" JSONB,
    "triggered_by" "cron_job_trigger_type" NOT NULL DEFAULT 'CRON',

    CONSTRAINT "cron_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_job_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule_override" TEXT,
    "time_zone_override" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cron_job_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_turnos" (
    "job_name" TEXT NOT NULL,
    "tomado_at" TIMESTAMPTZ(6) NOT NULL,
    "instancia" TEXT NOT NULL,

    CONSTRAINT "cron_turnos_pkey" PRIMARY KEY ("job_name")
);

-- CreateIndex
CREATE INDEX "empresas_es_organismo_idx" ON "empresas"("es_organismo");

-- CreateIndex
CREATE INDEX "empresas_es_proveedor_idx" ON "empresas"("es_proveedor");

-- CreateIndex
CREATE INDEX "procesos_tipo_idx" ON "procesos"("tipo");

-- CreateIndex
CREATE INDEX "procesos_comprador_rut_idx" ON "procesos"("comprador_rut");

-- CreateIndex
CREATE INDEX "procesos_fecha_publicacion_idx" ON "procesos"("fecha_publicacion");

-- CreateIndex
CREATE INDEX "procesos_adjuntos_estado_idx" ON "procesos"("adjuntos_estado");

-- CreateIndex
CREATE INDEX "procesos_tipo_detalle_revisado_at_idx" ON "procesos"("tipo", "detalle_revisado_at");

-- CreateIndex
CREATE INDEX "ofertas_proveedor_rut_idx" ON "ofertas"("proveedor_rut");

-- CreateIndex
CREATE UNIQUE INDEX "ofertas_proceso_codigo_codigo_item_proveedor_rut_key" ON "ofertas"("proceso_codigo", "codigo_item", "proveedor_rut");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_compra_codigo_key" ON "ordenes_compra"("codigo");

-- CreateIndex
CREATE INDEX "ordenes_compra_fecha_envio_idx" ON "ordenes_compra"("fecha_envio");

-- CreateIndex
CREATE INDEX "ordenes_compra_comprador_rut_idx" ON "ordenes_compra"("comprador_rut");

-- CreateIndex
CREATE INDEX "ordenes_compra_proveedor_rut_idx" ON "ordenes_compra"("proveedor_rut");

-- CreateIndex
CREATE INDEX "ordenes_compra_proceso_codigo_idx" ON "ordenes_compra"("proceso_codigo");

-- CreateIndex
CREATE INDEX "ordenes_compra_tipo_proceso_codigo_idx" ON "ordenes_compra"("tipo", "proceso_codigo");

-- CreateIndex
CREATE INDEX "orden_compra_items_orden_compra_id_idx" ON "orden_compra_items"("orden_compra_id");

-- CreateIndex
CREATE UNIQUE INDEX "adjudicaciones_clave_key" ON "adjudicaciones"("clave");

-- CreateIndex
CREATE INDEX "adjudicaciones_proceso_codigo_idx" ON "adjudicaciones"("proceso_codigo");

-- CreateIndex
CREATE INDEX "adjudicaciones_proveedor_rut_idx" ON "adjudicaciones"("proveedor_rut");

-- CreateIndex
CREATE INDEX "adjudicaciones_detectada_at_idx" ON "adjudicaciones"("detectada_at");

-- CreateIndex
CREATE INDEX "documentos_estado_idx" ON "documentos"("estado");

-- CreateIndex
CREATE INDEX "documentos_extraccion_estado_idx" ON "documentos"("extraccion_estado");

-- CreateIndex
CREATE UNIQUE INDEX "documentos_proceso_codigo_id_externo_key" ON "documentos"("proceso_codigo", "id_externo");

-- CreateIndex
CREATE UNIQUE INDEX "contactos_clave_key" ON "contactos"("clave");

-- CreateIndex
CREATE INDEX "contactos_rut_idx" ON "contactos"("rut");

-- CreateIndex
CREATE INDEX "contactos_rol_idx" ON "contactos"("rol");

-- CreateIndex
CREATE INDEX "contactos_proceso_codigo_idx" ON "contactos"("proceso_codigo");

-- CreateIndex
CREATE UNIQUE INDEX "archivos_masivos_tipo_anio_mes_key" ON "archivos_masivos"("tipo", "anio", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "cron_job_runs_run_id_key" ON "cron_job_runs"("run_id");

-- CreateIndex
CREATE INDEX "cron_job_runs_job_name_started_at_idx" ON "cron_job_runs"("job_name", "started_at" DESC);

-- CreateIndex
CREATE INDEX "cron_job_runs_status_idx" ON "cron_job_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "cron_job_configs_job_name_key" ON "cron_job_configs"("job_name");

-- AddForeignKey
ALTER TABLE "ofertas" ADD CONSTRAINT "ofertas_proceso_codigo_fkey" FOREIGN KEY ("proceso_codigo") REFERENCES "procesos"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_items" ADD CONSTRAINT "orden_compra_items_orden_compra_id_fkey" FOREIGN KEY ("orden_compra_id") REFERENCES "ordenes_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjudicaciones" ADD CONSTRAINT "adjudicaciones_proceso_codigo_fkey" FOREIGN KEY ("proceso_codigo") REFERENCES "procesos"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_proceso_codigo_fkey" FOREIGN KEY ("proceso_codigo") REFERENCES "procesos"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;


-- Vista de lectura: cada adjudicación con el enlace al proceso, el comprador
-- (deudor), el proveedor adjudicado (vendedor) y la OC que la materializa.
CREATE VIEW "v_adjudicaciones" AS
SELECT
  a."id",
  a."proceso_codigo",
  p."tipo" AS "proceso_tipo",
  p."codigo_tipo",
  p."nombre" AS "proceso_nombre",
  COALESCE(p."link", 'https://www.mercadopublico.cl/fichaLicitacion.html?idLicitacion=' || p."codigo") AS "proceso_link",
  p."comprador_rut",
  comprador."razon_social" AS "comprador_nombre",
  a."proveedor_rut",
  proveedor."razon_social" AS "proveedor_nombre",
  a."orden_compra_id",
  oc."codigo" AS "orden_compra_codigo",
  oc."link" AS "orden_compra_link",
  oc."fecha_envio" AS "orden_compra_fecha_envio",
  COALESCE(a."monto", oc."monto_total_clp") AS "monto",
  a."origen",
  a."detectada_at"
FROM "adjudicaciones" a
JOIN "procesos" p ON p."codigo" = a."proceso_codigo"
LEFT JOIN "empresas" comprador ON comprador."rut" = p."comprador_rut"
LEFT JOIN "empresas" proveedor ON proveedor."rut" = a."proveedor_rut"
LEFT JOIN "ordenes_compra" oc ON oc."id" = a."orden_compra_id";
