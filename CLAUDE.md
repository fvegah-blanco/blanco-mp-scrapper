# blanco-mp-scrapper

## UI: mismo diseño que el back office

Toda pantalla de este proyecto se ve como `backoffice-fe`, no con un estilo propio:

- **Layout**: sidebar izquierdo de 240 px plegable a 64 px (preferencia `sidebar_collapsed`), con el logo de Blanco
  (`public/logo-full.svg`, invertido en oscuro) y el isotipo (`public/logo-bf.svg`) cuando está plegado. Secciones en
  mayúsculas pequeñas; el ítem activo lleva el borde coral a la izquierda (`--brand-signal`).
- **Encabezado de página** como `PageHeader` / `ListPageShell`: ícono en caja `bg-muted` de 36 px, título 24 px
  semibold, descripción en `muted-foreground`, borde inferior; contenido con ancho máximo 1152 px.
- **Tokens**: los de `backoffice-fe/app/globals.css` (claro y oscuro), tipografía Geist, íconos lucide, botones
  `action`, badges con fondo suave, tablas con borde y cabecera `muted-foreground`. No inventar colores.
- **Interacciones**: historial en panel lateral (sheet), edición en modal; nada de `prompt()`/`alert()`.
- Antes de dar por terminado un cambio visual: capturas en claro y oscuro y contraste medido (texto >= 4,5:1).

El panel vive en `public/index.html` (HTML + JS sin build, servido por Nest en `/`). Si crece, migrarlo a Next.js con
los componentes del back office.

## API: mismas reglas en todos los endpoints

- **Respuesta**: `{ success: true, data }`. Los listados paginados suman `total`, `page`, `limit`. Las acciones que siguen
  en segundo plano responden 202 con `message`.
- **Códigos**: acciones `POST` síncronas con `@HttpCode(200)`; 400 por validación, 404 si no existe, 409 si ya corre.
- **Entradas**: cuerpos y consultas con DTO (`class-validator`); nunca interfaces en línea. Códigos de Mercado Público con
  `CodigoMpPipe`, ids con `ParseUUIDPipe`.
- **Swagger**: cada controlador con `@ApiTags` y `@ApiSecurity('x-admin-key')`; cada endpoint con `@ApiOperation`.
- **Guard**: todo controlador nuevo lleva `@UseGuards(AdminKeyGuard)`; solo `/health` va sin llave.
- Un endpoint nuevo o cambiado se documenta en `docs/api/` en el mismo commit.

## Seguridad: no retroceder

- Nada que venga de la URL, de un cuerpo o de Mercado Público arma una ruta de disco sin pasar por `StorageService`.
- Toda descarga usa `leerConTope`; no `res.arrayBuffer()` sobre adjuntos.
- Texto ingerido que se pinta en el panel pasa por `esc()`; enlaces por `url()`.
- El repo es público: sin secretos y sin datos reales de personas en ejemplos ni pruebas.

## Documentación

`README.md` es corto: qué es, fuentes, cómo correr, ejemplos. El detalle vive en `docs/` (índice en `docs/README.md`).
