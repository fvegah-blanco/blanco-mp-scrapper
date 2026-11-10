import { Injectable } from '@nestjs/common';
import { fetchJsonMp } from '../common/http';

const API = 'https://api.buscador.mercadopublico.cl';

interface Respuesta<T> {
  success: string;
  payload: T;
  message?: string;
}

export interface PaginaBuscador<T> {
  resultCount: number;
  pageCount: number;
  page: number;
  pageSize: number;
  resultados: T[];
}

/** Fila del buscador de órdenes de compra. */
export interface OcBuscador {
  id: number;
  codigo: string;
  nombre: string;
  /** "10-11-2026 13:19:59" (hora de Chile). */
  fecha_envio: string;
  nombre_organismo_comprador: string;
  rut_organismo_comprador: string;
  unidad_compra: string;
  id_estado: number;
  estado: string;
  monto_total: number;
  moneda: string;
  nombre_proveedor: string;
  rut_proveedor: string;
}

/** Fila del buscador de compras ágiles. */
export interface CaBuscador {
  id: number;
  codigo: string;
  nombre: string;
  fecha_publicacion: string;
  fecha_cierre: string;
  organismo: string;
  unidad: string;
  id_estado: number;
  estado: string;
  monto_disponible: number | null;
  moneda: string;
  monto_disponible_CLP: number | null;
  cantidad_proveedores_cotizando: number;
}

export interface CotizacionFicha {
  id_cotizacion?: number;
  rut_proveedor: string;
  razon_social: string;
  proveedor_seleccionado: number;
  id_oc: number | null;
  monto_total: number | null;
  valor_neto: number | null;
  estado: number | null;
  fecha_creacion?: string;
  descripcion_cotizacion?: string;
}

export interface FichaCompraAgil {
  detalle_id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  fecha_publicacion: string;
  fecha_cierre: string;
  id_estado: number;
  estado: string;
  direccion_entrega: string | null;
  presupuesto_estimado: number | null;
  moneda: string | null;
  proveedores_cotizando: CotizacionFicha[] | null;
  informacion_institucion: { organismo_comprador?: string; rut_organismo_comprador?: string; division?: string } | null;
  id_orden_compra: number | null;
  total_ofertas_recibidas: number | null;
}

/** Estados del buscador de compra ágil (bundle del SPA). */
export const ESTADO_CA = { PUBLICADA: 2, CERRADA: 3, PROVEEDOR_SELECCIONADO: 4, CANCELADA: 5, DESIERTA: 6 } as const;

/**
 * API del buscador público (buscador.mercadopublico.cl), la misma que usa su
 * SPA con la api-key que trae en el bundle. No usa ticket ni tiene cuota
 * diaria, pero corta a los 29 s: `fetchJsonMp` reintenta.
 */
@Injectable()
export class BuscadorClient {
  private get headers() {
    return {
      'x-api-key': process.env.MP_BUSCADOR_API_KEY ?? 'e93089e4-437c-4723-b343-4fa20045e3bc',
      Origin: 'https://buscador.mercadopublico.cl',
      Referer: 'https://buscador.mercadopublico.cl/',
    };
  }

  /** Órdenes de compra enviadas entre dos fechas (YYYY-MM-DD), las más recientes primero. 20 por página. */
  async buscarOrdenes(p: { desde: string; hasta: string; pagina: number }): Promise<PaginaBuscador<OcBuscador>> {
    const qs = new URLSearchParams({ date_from: p.desde, date_to: p.hasta, order_by: 'recent', page_number: String(p.pagina) });
    const r = await fetchJsonMp<Respuesta<PaginaBuscador<OcBuscador>>>(`${API}/ordenes-de-compra?${qs}`, { headers: this.headers });
    return r.payload;
  }

  /** Compras ágiles publicadas entre dos fechas. 15 por página. */
  async buscarComprasAgiles(p: {
    desde: string;
    hasta: string;
    pagina: number;
    estado?: number;
    palabras?: string;
    /** Un solo intento con timeout corto: la búsqueda por palabras suele dar 504 y no vale la pena insistir. */
    rapido?: boolean;
  }): Promise<PaginaBuscador<CaBuscador>> {
    const qs = new URLSearchParams({ date_from: p.desde, date_to: p.hasta, order_by: 'recent', page_number: String(p.pagina) });
    if (p.estado) qs.set('status', String(p.estado));
    if (p.palabras) qs.set('keywords', p.palabras);
    const r = await fetchJsonMp<Respuesta<PaginaBuscador<CaBuscador>>>(
      `${API}/compra-agil?${qs}`,
      p.rapido ? { headers: this.headers, reintentos: 0, timeoutMs: 35_000 } : { headers: this.headers },
    );
    return r.payload;
  }

  async fichaCompraAgil(codigo: string, rapido = false): Promise<FichaCompraAgil | null> {
    const qs = new URLSearchParams({ action: 'ficha', code: codigo.toUpperCase() });
    const r = await fetchJsonMp<Respuesta<FichaCompraAgil>>(
      `${API}/compra-agil?${qs}`,
      rapido ? { headers: this.headers, reintentos: 0, timeoutMs: 35_000 } : { headers: this.headers },
    );
    return r.payload && typeof r.payload === 'object' && 'codigo' in r.payload ? r.payload : null;
  }
}
