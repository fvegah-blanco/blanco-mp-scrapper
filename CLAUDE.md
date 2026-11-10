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
