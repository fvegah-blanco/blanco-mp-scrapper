-- AlterTable
ALTER TABLE "documentos" ADD COLUMN     "analisis_ia_costo_usd" DECIMAL(12,6),
ADD COLUMN     "analisis_ia_ms" INTEGER,
ADD COLUMN     "analisis_ia_paginas" INTEGER,
ADD COLUMN     "analisis_ia_tokens_entrada" INTEGER,
ADD COLUMN     "analisis_ia_tokens_salida" INTEGER,
ADD COLUMN     "extraccion_ms" INTEGER;
