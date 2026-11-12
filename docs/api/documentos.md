# API: documentos

Lo mismo que hacen los crons de adjuntos, para un proceso o documento puntual. Convenciones: [README](README.md). Flujo: [ingesta](../flows/ingesta.md) y [contactos](../flows/contactos.md).

### `POST /api/documentos/encolar`

Encola la descarga de adjuntos; el cron `adjuntos-descarga` los baja.

| Param | Tipo | Requerido | Descripción |
|---|---|---|---|
| codigos | string[] | sí | 1 a 500 códigos de proceso |
| forzar | bool | no | Vuelve a encolar aunque ya se hayan bajado |

| Código | Descripción |
|---|---|
| 200 | `data: { encolados }` |
| 400 | Lista vacía o algún código inválido |

### `POST /api/documentos/procesos/:codigo/descargar`

Baja ahora los adjuntos del proceso (bases y documentos del adjudicado). Puede tardar hasta un par de minutos.

| Código | Descripción |
|---|---|
| 200 | `data: { nuevos }`: archivos nuevos guardados |
| 400 | Código inválido |

### `POST /api/documentos/procesos/:codigo/extraer-contactos`

Vuelve a correr el extractor de contactos por regex sobre el texto ya guardado. No llama a la IA.

| Código | Descripción |
|---|---|
| 200 | `data: { contactos }` |

### `POST /api/documentos/:id/extraer`

Extrae el texto del documento (OCR si es escaneado) y sus contactos.

| Código | Descripción |
|---|---|
| 200 | `data: { texto, contactos }` |
| 400 | El id no es un UUID |
| 404 | El documento no existe |

### `POST /api/documentos/:id/analizar-ia`

Manda el documento a Bedrock ahora, aunque sea de las bases. Tiene costo.

| Código | Descripción |
|---|---|
| 200 | `data: { contactos, modelo, analisisIa }` |
| 400 | Faltan las credenciales de Bedrock, o el id no es un UUID |
| 404 | El documento no existe |

**Ejemplo de respuesta:**
```json
{
  "success": true,
  "data": {
    "contactos": 2,
    "modelo": "openai.gpt-5.6-luna",
    "analisisIa": {
      "razon_social": "Comercial Ejemplo SpA",
      "rut_empresa": "76.123.456-7",
      "contactos": [{ "rol": "representante_legal", "nombre": "Nombre Apellido", "email": "contacto@ejemplo.cl", "telefono": "+56 9 1234 5678" }]
    }
  }
}
```
