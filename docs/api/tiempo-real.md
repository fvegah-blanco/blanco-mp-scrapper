# API: tiempo real

Lo mismo que hacen los crons de tiempo real, para un código puntual. Convenciones: [README](README.md). Flujo: [ingesta](../flows/ingesta.md).

### `POST /api/tiempo-real/ordenes/:codigo/cruzar`

Relee la ficha de una OC que ya está en la base y busca su proceso.

| Param | Tipo | Requerido | Descripción |
|---|---|---|---|
| codigo | string (ruta) | sí | Código de la OC, por ejemplo `1196-267-AG26` |

| Código | Descripción |
|---|---|
| 200 | Resultado del cruce |
| 400 | Código inválido |
| 404 | La OC no está en la base |

**Ejemplo de respuesta:**
```json
{
  "success": true,
  "data": {
    "codigo": "1196-267-AG26", "procesoCodigo": "1196-63-COT26", "fichaError": null, "fichas": { "leidas": 1, "contactos": 2, "procesos": 0, "fallidas": 0 },
    "match": { "intentadas": 1, "porTexto": 1, "porBusqueda": 0, "fallidas": 0, "fichas": { "leidas": 1, "sinFicha": 0, "fallidas": 0 } } }
}
```

### `POST /api/tiempo-real/compras-agiles/:codigo/ficha`

Relee la ficha de una compra ágil: cotizaciones, ganador e id de cada cotización.

| Código | Descripción |
|---|---|
| 200 | `data: { codigo, estado, ofertas[] }` |
| 400 | Código inválido |
| 404 | El buscador no tiene ficha para ese código |
