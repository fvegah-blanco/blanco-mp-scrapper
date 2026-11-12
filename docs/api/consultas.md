# API: consultas

Lectura de lo ingerido. Convenciones: [README](README.md). Tablas: [modelo de datos](../models/modelo-de-datos.md).

### `GET /api/consultas/resumen`

Conteos generales: organismos, proveedores, procesos por tipo, OC por fuente, OC de compra ágil sin cruzar, adjudicaciones, documentos, contactos y la última OC en tiempo real.

### `GET /api/consultas/adjudicaciones`

Adjudicaciones con el proceso, el comprador, el proveedor y la OC, de la más reciente a la más antigua.

| Param | Tipo | Requerido | Descripción |
|---|---|---|---|
| page, limit | int | no | Paginación |
| tipo | enum | no | `COMPRA_AGIL`, `LICITACION_PUBLICA`, `LICITACION_PRIVADA`, `CONVENIO_MARCO`, `TRATO_DIRECTO`, `OTRO` |
| rut | string | no | RUT del comprador o del proveedor |
| desde | fecha | no | Detectadas desde esa fecha |

### `GET /api/consultas/contactos`

| Param | Tipo | Requerido | Descripción |
|---|---|---|---|
| page, limit | int | no | Paginación |
| rol | enum | no | `COMPRADOR`, `PROVEEDOR`, `DESCONOCIDO` |
| rut | string | no | RUT de la empresa |
| minConfianza | number | no | Entre 0 y 1 |

**Ejemplo de respuesta:**
```json
{
  "success": true,
  "data": [{
    "id": "0b4476c4-46ad-4834-8229-cafb6ee95c5c",
    "rut": "61123456-7",
    "rol": "COMPRADOR",
    "nombre": "Nombre Apellido",
    "cargo": "Encargada de compras",
    "email": "compras@organismo.gob.cl",
    "telefono": "+56221234567",
    "fuente": "FICHA_OC",
    "evidencia": "Ficha OC 800-6525-AG26: contacto de la unidad de compra",
    "confianza": 0.95,
    "vecesVisto": 2,
    "origen": { "tipo": "OC", "codigo": "800-6525-AG26", "link": "https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=800-6525-AG26" }
  }],
  "total": 103, "page": 1, "limit": 1
}
```

`origen` indica dónde verificar el dato: la OC (`tipo: "OC"`) o el documento y su proceso (`tipo: "DOCUMENTO"`).

### `GET /api/consultas/empresas/:rut`

Ficha de un RUT: datos de la empresa, hasta 100 contactos, hasta 100 adjudicaciones como proveedor y el total comprado como organismo.

| Código | Descripción |
|---|---|
| 200 | `data: { empresa, contactos, adjudicaciones, comoComprador }` |
| 404 | RUT inválido o no visto |

### `GET /api/consultas/procesos/:codigo`

Ficha de un proceso: ofertas, adjudicaciones, documentos, OC y contactos.

| Código | Descripción |
|---|---|
| 200 | `data: { proceso, ordenes, contactos }` |
| 400 | Código inválido |
| 404 | El proceso no está en la base |

### `GET /api/consultas/ia`

Gasto y tiempos de la IA: totales del período, gasto por día y detalle de los últimos 200 documentos.

| Param | Tipo | Requerido | Descripción |
|---|---|---|---|
| dias | int | no | 1 a 365. Default: 30 |

`data.precio` trae el modelo principal, el de respaldo y los precios con que se calcula el costo.
