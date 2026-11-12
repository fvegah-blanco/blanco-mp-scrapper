# Fuentes de Mercado Público

Todo se obtiene sin navegador, con HTTP directo. Relacionado: [flujo de ingesta](flows/ingesta.md), [crons](jobs/crons.md).

| Fuente | Dirección | Código |
|---|---|---|
| Datos abiertos | `transparenciachc.blob.core.windows.net/{oc-da,lic-da}/AAAA-M.zip` | `src/datos-abiertos` |
| Buscador | `api.buscador.mercadopublico.cl` | `src/mercado-publico/buscador.client.ts` |
| Ficha de la OC | `mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=` | `src/mercado-publico/ficha-oc.client.ts` |
| Adjuntos de licitación | Ficha → `VerAntecedentes.aspx` | `src/mercado-publico/adjuntos.client.ts` |
| Cuadro de ofertas | `Procurement/Modules/RFB/StepsProcessAward/` | `src/mercado-publico/ofertas.client.ts` |
| Adjuntos de compra ágil | `adjunto.mercadopublico.cl/adjunto-compra-agil/v1` | `src/mercado-publico/adjuntos.client.ts` |

## Datos abiertos

- Un `.zip` por tipo y mes, con `ETag` y `Last-Modified`.
- El CSV viene en latin1, separado por `;`, con coma decimal y `NA` como vacío.
- Órdenes de compra: una fila por línea de la OC (unas 136 mil filas y 49 mil OC por mes).
- Licitaciones: una fila por ítem × oferta, con la columna `Oferta seleccionada`.
- Las licitaciones se agrupan por mes de publicación y ChileCompra regenera meses anteriores cuando cambia el estado de una licitación. Por eso se compara el ETag de todos los meses, no solo el del mes en curso.

## Buscador

- Usa la api-key pública que el propio sitio incrusta en su JavaScript (`MP_BUSCADOR_API_KEY`).
- No tiene cuota diaria. Corta a los 29 segundos y entrega hasta 10.000 resultados por búsqueda.
- La búsqueda de compra ágil por palabras responde 504 con frecuencia: se hace con un solo intento y fuera del ciclo de tiempo real.

## Ficha de la orden de compra

- El HTML muestra el correo como imagen ofuscada, pero el `__VIEWSTATE` de la página trae en claro nombre, cargo, teléfono y correo del comprador.
- Si la OC ya fue aceptada, trae también los del proveedor.
- Si el correo solo está en la imagen, se lee con OCR.
- En las OC de licitación (SE, CC) la ficha trae el código de la licitación aunque el buscador no lo informe.

## Órdenes de compra de compra ágil

- La OC (tipo AG) no trae el código de la compra ágil en `CodigoLicitacion`.
- Cerca del 80% lo trae en el nombre: Mercado Público lo escribe solo ("Orden de Compra generada por invitación a compra ágil: 3485-1129-COT26").
- Para el resto se busca en el buscador de compra ágil dentro de la misma unidad de compra (mismo prefijo: `1196-267-AG26` ↔ `1196-63-COT26`) y se confirma que `id_orden_compra` de la ficha sea el ID de la OC.

## Adjuntos

- **Licitación.** Cada botón "Ver Anexo" es un POST con el `__VIEWSTATE` de la página y la cookie de sesión.
- **Adjudicado de una licitación.** Ficha → Cuadro de Ofertas → oferente por RUT → grilla de anexos (paginada de a 6). Se lista todo sin descargar y se baja solo lo que parece Anexo N°1.
- **Compra ágil.** La ficha trae `id_cotizacion` por cada cotización; `cotizacion/listar/{id}` devuelve los archivos que subió el proveedor.
- **Bloqueo.** El portal de licitaciones bloquea por IP pasado cierto volumen. Hay una pausa entre solicitudes (`adjuntos.pausa_ms`) y un 403 corta la corrida, que se retoma en la siguiente.

## Mediciones (10-11-2026, en local)

| Operación | Resultado |
|---|---|
| Licitaciones de octubre | 102.626 filas en 66 s, sin errores |
| OC de noviembre | 135.885 filas en 90 s, sin errores |
| Cruce de OC de compra ágil por nombre | 16.706 de 21.241 |
| Un ciclo de tiempo real | 974 OC vistas, 65 nuevas, 51 contactos, unos 6 minutos |
| Adjuntos de una licitación (7 anexos) | 7 s |
| Lectura con IA | Unos 2,3 s y US$ 0,0014 por documento con Luna |
