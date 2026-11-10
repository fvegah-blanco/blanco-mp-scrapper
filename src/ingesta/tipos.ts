import type { FuenteDato, OrigenAdjudicacion, TipoProceso } from '@prisma/client';

export interface EmpresaReg {
  rut: string;
  razonSocial: string | null;
  esOrganismo: boolean;
  esProveedor: boolean;
  codigoOrganismo?: string | null;
  codigoProveedor?: string | null;
  sector?: string | null;
  actividad?: string | null;
  comuna?: string | null;
  region?: string | null;
}

export interface ProcesoReg {
  codigo: string;
  tipo: TipoProceso;
  codigoTipo: string | null;
  idMp: bigint | null;
  nombre: string | null;
  descripcion: string | null;
  link: string | null;
  estado: string | null;
  compradorRut: string | null;
  codigoOrganismo: string | null;
  organismo: string | null;
  unidad: string | null;
  region: string | null;
  fechaPublicacion: Date | null;
  fechaCierre: Date | null;
  fechaAdjudicacion: Date | null;
  montoEstimado: string | null;
  moneda: string | null;
  numeroOferentes: number | null;
  fuente: FuenteDato;
}

export interface OfertaReg {
  procesoCodigo: string;
  codigoItem: string;
  correlativo: number | null;
  producto: string | null;
  proveedorRut: string;
  nombreOferta: string | null;
  estadoOferta: string | null;
  cantidadOfertada: string | null;
  montoUnitario: string | null;
  valorTotal: string | null;
  cantidadAdjudicada: string | null;
  montoAdjudicado: string | null;
  seleccionada: boolean;
  fechaEnvio: Date | null;
  /** Compra ágil: id_cotizacion. */
  idExterno?: string | null;
}

export interface OrdenReg {
  id: bigint;
  codigo: string;
  link: string | null;
  nombre: string | null;
  descripcion: string | null;
  tipo: string | null;
  procedencia: string | null;
  esCompraAgil: boolean;
  esTratoDirecto: boolean;
  estado: string | null;
  estadoProveedor: string | null;
  fechaCreacion: Date | null;
  fechaEnvio: Date | null;
  fechaAceptacion: Date | null;
  fechaCancelacion: Date | null;
  montoTotal: string | null;
  moneda: string | null;
  montoTotalClp: string | null;
  compradorRut: string | null;
  unidadCompra: string | null;
  codigoUnidadCompra: string | null;
  organismo: string | null;
  codigoOrganismo: string | null;
  proveedorRut: string | null;
  proveedorNombre: string | null;
  codigoProveedor: string | null;
  procesoCodigo: string | null;
  convenioMarco: string | null;
  formaPago: string | null;
  fuente: FuenteDato;
}

export interface ItemReg {
  id: bigint;
  ordenCompraId: bigint;
  codigoProductoOnu: string | null;
  producto: string | null;
  rubro: string | null;
  especificacionComprador: string | null;
  especificacionProveedor: string | null;
  cantidad: string | null;
  unidadMedida: string | null;
  precioNeto: string | null;
  totalLineaNeto: string | null;
}

export interface AdjudicacionReg {
  procesoCodigo: string;
  proveedorRut: string;
  ordenCompraId: bigint | null;
  monto: string | null;
  origen: OrigenAdjudicacion;
}

/** Tipo de proceso según la sigla del código (…-LE26, …-COT26, …-E225). */
export function tipoDesdeCodigo(codigo: string): { tipo: TipoProceso; codigoTipo: string | null } {
  const m = codigo.toUpperCase().match(/-([A-Z][A-Z0-9]?|COT)(\d{2})$/);
  const sigla = m?.[1] ?? null;
  if (!sigla) return { tipo: 'OTRO', codigoTipo: null };
  if (sigla === 'COT') return { tipo: 'COMPRA_AGIL', codigoTipo: sigla };
  if (['L1', 'LE', 'LP', 'LQ', 'LR', 'LS', 'O1'].includes(sigla)) {
    return { tipo: 'LICITACION_PUBLICA', codigoTipo: sigla };
  }
  if (['E2', 'CO', 'B2', 'H2', 'I2', 'O2'].includes(sigla)) {
    return { tipo: 'LICITACION_PRIVADA', codigoTipo: sigla };
  }
  return { tipo: 'OTRO', codigoTipo: sigla };
}

/** Une dos registros de la misma empresa sin perder banderas ni datos. */
export function combinarEmpresas(a: EmpresaReg, b: EmpresaReg): EmpresaReg {
  return {
    rut: a.rut,
    razonSocial: b.razonSocial ?? a.razonSocial,
    esOrganismo: a.esOrganismo || b.esOrganismo,
    esProveedor: a.esProveedor || b.esProveedor,
    codigoOrganismo: b.codigoOrganismo ?? a.codigoOrganismo,
    codigoProveedor: b.codigoProveedor ?? a.codigoProveedor,
    sector: b.sector ?? a.sector,
    actividad: b.actividad ?? a.actividad,
    comuna: b.comuna ?? a.comuna,
    region: b.region ?? a.region,
  };
}
