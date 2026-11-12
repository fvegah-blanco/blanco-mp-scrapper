# Seguridad

Controles vigentes y riesgos aceptados. Revisión del 12-11-2026. Relacionado: [API](api/README.md), [despliegue](despliegue.md), [brechas](GAP-ANALYSIS.md).

## Controles

| Riesgo | Control | Dónde |
|---|---|---|
| API abierta por olvido | En producción la app no arranca sin `ADMIN_API_KEY`; si faltara, todo responde 503 | `src/common/admin-key.guard.ts`, `src/main.ts` |
| Adivinar la llave midiendo tiempos | Se comparan huellas SHA-256 en tiempo constante | `admin-key.guard.ts` |
| La llave en los logs | `x-admin-key`, `authorization` y `cookie` se ocultan | `src/app.module.ts` |
| Rutas fuera del almacenamiento | Los códigos de la URL deben tener forma de código de Mercado Público; toda clave se resuelve dentro de `STORAGE_DIR` | `codigo-mp.pipe.ts`, `storage.service.ts` |
| Leer archivos del servidor | `importar-local` solo acepta `.csv` dentro de `TMP_DIR` | `datos-abiertos.controller.ts` |
| Adjunto gigante que llena la memoria | La descarga se corta al pasar `adjuntos.max_mb_por_archivo` | `leerConTope` en `src/common/http.ts` |
| Zip malicioso | Hasta 40 archivos de 30 MB por zip, sin zip anidados y sin escribir a disco | `texto.service.ts` |
| Seguir enlaces a otro sitio | De la ficha solo se siguen enlaces `https` de `mercadopublico.cl` | `adjuntos.client.ts` |
| Inyección SQL | Prisma y consultas parametrizadas; no hay SQL armado con texto | Todo el proyecto |
| Entradas inválidas | DTO con validación en cuerpos y consultas; UUID y códigos validados en la ruta | `dto/`, `ValidationPipe` global |
| Código en el panel desde datos ingeridos | Todo texto se escapa; los enlaces solo admiten `http(s)` | `public/index.html` |
| Marco, sniffing y origen de recursos | CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer` | `src/main.ts` |
| Borrar estado interno por la API | Solo se restablecen parámetros conocidos, no las marcas de los crons | `configuracion.service.ts` |
| Proceso con privilegios | El contenedor corre como usuario `node` | `Dockerfile` |
| Puertos expuestos en la red local | El compose publica solo en `127.0.0.1` | `docker-compose.yml` |
| Instrucciones dentro de un documento | La IA responde con un esquema fijo y sus contactos pasan por reglas de filtrado; no ejecuta acciones | `analisis-ia.service.ts` |

## Secretos

- El repositorio no contiene secretos. Las credenciales de Bedrock y la llave de administración llegan por variables de entorno.
- `MP_BUSCADOR_API_KEY` y `MP_ADJUNTOS_USER_KEY` son las llaves públicas que el sitio de Mercado Público entrega a cualquier navegador.
- Los ejemplos de la documentación usan datos ficticios.

## Riesgos aceptados

| Riesgo | Por qué se acepta | Mitigación recomendada |
|---|---|---|
| Una sola llave compartida, sin usuarios ni roles | Servicio interno de administración | Publicarlo solo dentro de la red privada (Tailscale) o detrás de la sesión del back office |
| Sin límite de intentos sobre la llave | Igual que el punto anterior | Límite de solicitudes en el proxy |
| El panel guarda la llave en `localStorage` | Panel de uso interno | Se resuelve al integrar la sesión del back office |
| `x-admin-user` no se verifica | Es solo informativo para el historial | Igual que el anterior |
| CSP con `'unsafe-inline'` | El panel es un HTML único con script y estilos en línea | Separar el script si el panel crece |
| `uuid` vulnerable (moderada) dentro de `exceljs` | El fallo está en una función que `exceljs` no usa con datos externos; corregirlo exige bajar `exceljs` de versión | Actualizar cuando `exceljs` publique el arreglo |
| Datos personales (nombres, correos, teléfonos) | Son datos publicados por Mercado Público | Acceso restringido a la base y al panel |
