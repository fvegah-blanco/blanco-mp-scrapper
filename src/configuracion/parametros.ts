/**
 * Parámetros vivos con su valor por defecto. Se cambian por API
 * (PATCH /configuracion/:clave) sin redeploy; la tabla `configuraciones` solo
 * guarda los que alguien tocó.
 */
export const PARAMETROS = {
  'datos_abiertos.anio_desde': {
    valor: new Date().getFullYear(),
    descripcion: 'Primer año que mantiene al día el sync masivo (backfill mínimo: el año en curso).',
  },
  'datos_abiertos.guardar_items_oc': {
    valor: true,
    descripcion: 'Guarda las líneas de cada OC (orden_compra_items). Apagar si la base crece demasiado.',
  },
  'datos_abiertos.lote_filas': {
    valor: 1000,
    descripcion: 'Filas del CSV por upsert.',
  },
  'tiempo_real.solape_minutos': {
    valor: 90,
    descripcion: 'Cuánto hacia atrás vuelve a mirar el poll de OC respecto de la última OC vista.',
  },
  'tiempo_real.max_paginas': {
    valor: 100,
    descripcion: 'Tope de páginas (20 OC c/u) por corrida del poll de OC.',
  },
  'match_compra_agil.lote': {
    valor: 300,
    descripcion: 'OC de compra ágil sin proceso que se intentan cruzar por corrida.',
  },
  'match_compra_agil.busqueda_por_palabras': {
    valor: true,
    descripcion: 'Si la OC no trae el COT en el nombre, buscarlo en el buscador por palabras (lento: ~1 búsqueda por OC).',
  },
  'match_compra_agil.lote_busquedas': {
    valor: 10,
    descripcion: 'Tope de búsquedas por palabras por corrida (el buscador corta a los 29 s).',
  },
  'match_compra_agil.presupuesto_segundos': {
    valor: 240,
    descripcion: 'Tiempo máximo por corrida para las búsquedas por palabras (el buscador responde lento o con 504).',
  },
  'compras_agiles.lote_fichas': {
    valor: 60,
    descripcion: 'Fichas de compra ágil que se leen por corrida (cotizaciones: quién ofertó, por cuánto y quién ganó).',
  },
  'match_compra_agil.max_intentos': {
    valor: 4,
    descripcion: 'Intentos antes de dejar de buscar la compra ágil de una OC.',
  },
  'match_compra_agil.dias_atras': {
    valor: 20,
    descripcion: 'Ventana de publicación (días antes del envío de la OC) donde se busca la compra ágil.',
  },
  'fichas_oc.lote': {
    valor: 80,
    descripcion: 'Fichas públicas de OC que se leen por corrida (contacto del comprador, licitación de origen).',
  },
  'fichas_oc.solo_tiempo_real': {
    valor: true,
    descripcion: 'Leer fichas solo de OC llegadas por el poll en tiempo real (no del backfill masivo).',
  },
  'adjuntos.auto_encolar_adjudicados': {
    valor: true,
    descripcion: 'Encola la descarga de adjuntos de todo proceso adjudicado detectado en tiempo real.',
  },
  'adjuntos.lote_procesos': {
    valor: 10,
    descripcion: 'Procesos cuyos adjuntos se bajan por corrida.',
  },
  'adjuntos.max_archivos_por_proceso': {
    valor: 60,
    descripcion: 'Tope de adjuntos por proceso.',
  },
  'adjuntos.max_mb_por_archivo': {
    valor: 40,
    descripcion: 'Adjuntos más grandes se registran como OMITIDO.',
  },
  'adjuntos.max_intentos': {
    valor: 3,
    descripcion: 'Intentos de descarga de un proceso antes de dejarlo en ERROR.',
  },
  'adjuntos.documentos_adjudicado': {
    valor: true,
    descripcion: 'Bajar también los documentos del proveedor adjudicado: Anexo N°1 del cuadro de ofertas (licitación) o adjuntos de su cotización (compra ágil).',
  },
  'adjuntos.oferta_solo_anexo1': {
    valor: true,
    descripcion: 'En licitaciones, del oferente bajar solo el Anexo N°1 (si no se reconoce, los primeros PDF administrativos).',
  },
  'adjuntos.oferta_max_administrativos': {
    valor: 3,
    descripcion: 'PDF administrativos que se bajan cuando el oferente no tiene un archivo que parezca Anexo N°1.',
  },
  'adjuntos.pausa_ms': {
    valor: 400,
    descripcion: 'Pausa entre requests al portal de licitaciones (banea por IP pasado cierto volumen).',
  },
  'bedrock.habilitado': {
    valor: true,
    descripcion: 'Analizar con Bedrock los documentos del oferente (Anexo N°1 y cotizaciones). Sin credenciales BEDROCK_AWS_* no corre.',
  },
  'bedrock.lote': {
    valor: 20,
    descripcion: 'Documentos que se mandan a Bedrock por corrida (control de costo).',
  },
  'bedrock.max_paginas': {
    valor: 4,
    descripcion: 'Páginas de cada PDF que se mandan como imagen al modelo (el Anexo N°1 rara vez pasa de 2).',
  },
  'bedrock.precio_entrada_usd_mtok': {
    valor: 1,
    descripcion: 'USD por millón de tokens de entrada del modelo (Haiku 4.5: 1). Confirmar contra la tabla de Bedrock: es el que usa el costo por documento.',
  },
  'bedrock.precio_salida_usd_mtok': {
    valor: 5,
    descripcion: 'USD por millón de tokens de salida del modelo (Haiku 4.5: 5).',
  },
  'ia.dolar_clp': {
    valor: 950,
    descripcion: 'Pesos por dólar para mostrar el gasto en CLP (referencial).',
  },
  'extraccion.lote': {
    valor: 15,
    descripcion: 'Documentos que se pasan por texto/OCR por corrida.',
  },
  'extraccion.ocr_max_paginas': {
    valor: 15,
    descripcion: 'Páginas de un PDF escaneado que se pasan por OCR.',
  },
  'extraccion.texto_max_chars': {
    valor: 300000,
    descripcion: 'Largo máximo del texto guardado por documento.',
  },
} as const;

export type ClaveParametro = keyof typeof PARAMETROS;
