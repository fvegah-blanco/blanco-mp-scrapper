# API: parámetros

Valores que los crons leen en cada ejecución; se aplican sin redeploy. Convenciones: [README](README.md). Lista completa: [configuracion.md](../configuracion.md).

### `GET /api/configuracion`

**Ejemplo de respuesta:**
```json
{
  "success": true,
  "data": [{
    "clave": "bedrock.lote",
    "valor": 20,
    "valorPorDefecto": 20,
    "descripcion": "Documentos que se mandan a Bedrock por corrida (control de costo).",
    "modificado": false,
    "updatedBy": null,
    "updatedAt": null
  }]
}
```

### `PATCH /api/configuracion/:clave`

| Param | Tipo | Requerido | Descripción |
|---|---|---|---|
| clave | string (ruta) | sí | Clave del parámetro |
| valor | number \| boolean | sí | Del mismo tipo que el valor por defecto |

| Código | Descripción |
|---|---|
| 200 | `data: { clave, valor }` |
| 400 | Parámetro desconocido o tipo incorrecto |

### `DELETE /api/configuracion/:clave`

Vuelve el parámetro a su valor por defecto.

| Código | Descripción |
|---|---|
| 200 | `data: { clave }` |
| 400 | Parámetro desconocido |
