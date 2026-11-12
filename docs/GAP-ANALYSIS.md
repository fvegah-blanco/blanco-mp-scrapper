# Brechas y pendientes

Estado al 12-11-2026. Relacionado: [seguridad](seguridad.md), [despliegue](despliegue.md).

## Funcionales

| Brecha | Efecto | Propuesta |
|---|---|---|
| La página de anexos de una licitación puede paginar; hoy se lee la primera página de cada `VerAntecedentes` | Licitaciones con muchos anexos quedan incompletas | Recorrer la paginación como ya se hace en el cuadro de ofertas |
| Un documento con error de IA queda en `ERROR` | Hay que reprocesarlo a mano | Reintento automático con tope |
| El mismo nombre escrito distinto genera contactos repetidos | Duplicados en representantes legales | Unificar por similitud de nombre dentro del mismo RUT |
| No se consulta la situación tributaria del RUT (SII) | Falta un dato útil para evaluar al proveedor | Cron adicional sobre `empresas` |
| Algunos teléfonos de la ficha de la OC llegan en formatos que no se normalizan | Teléfonos descartados | Ampliar el normalizador |
| 55 procesos con el código mal formado en los datos abiertos | Registros que no cruzan con nada | Limpiar el código al importar |

## Técnicas

| Brecha | Efecto | Propuesta |
|---|---|---|
| Sin pruebas de extremo a extremo de la API | Los controladores solo se prueban a mano | Pruebas con una base temporal |
| Sin integración continua | Tipos y pruebas dependen de quien sube el cambio | Flujo de CI con `typecheck` y `test` |
| El panel es un HTML único sin build | Difícil de mantener si crece | Migrarlo a `backoffice-fe` |
| Autenticación con una llave compartida | Sin usuarios ni roles | Sesión del back office |
| El repositorio es público | Código interno expuesto; el historial trae nombres y correos reales en pruebas antiguas | Dejarlo privado |
| Sin métricas ni alertas | Las fallas se ven solo en el historial de crons | Alertas a Slack por cron fallido |
