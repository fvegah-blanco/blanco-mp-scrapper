-- CreateEnum
CREATE TYPE "origen_documento" AS ENUM ('BASES', 'OFERTA', 'COTIZACION');
-- CreateEnum
CREATE TYPE "estado_analisis_ia" AS ENUM ('NO_APLICA', 'PENDIENTE', 'OK', 'ERROR');
-- AlterEnum
ALTER TYPE "fuente_contacto" ADD VALUE 'DOCUMENTO_IA';
-- AlterTable
ALTER TABLE "documentos" ADD COLUMN     "analisis_ia" JSONB,
ADD COLUMN     "analisis_ia_error" TEXT,
ADD COLUMN     "analisis_ia_estado" "estado_analisis_ia" NOT NULL DEFAULT 'NO_APLICA',
ADD COLUMN     "analisis_ia_modelo" TEXT,
ADD COLUMN     "analizado_ia_at" TIMESTAMPTZ(6),
ADD COLUMN     "es_anexo_identificacion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "origen" "origen_documento" NOT NULL DEFAULT 'BASES',
ADD COLUMN     "proveedor_rut" TEXT;
-- AlterTable
ALTER TABLE "ofertas" ADD COLUMN     "id_externo" TEXT;
-- CreateIndex
CREATE INDEX "documentos_analisis_ia_estado_idx" ON "documentos"("analisis_ia_estado");
-- CreateIndex
CREATE INDEX "documentos_proveedor_rut_idx" ON "documentos"("proveedor_rut");
