import { codigoCompraAgilEnTexto } from '../common/codigos';
import { decimal, entero, fecha, siNo, texto } from '../common/parse';
import { normalizarRut } from '../common/rut';
import type { EmpresaReg, ItemReg, OfertaReg, OrdenReg, ProcesoReg } from '../ingesta/tipos';
import { tipoDesdeCodigo } from '../ingesta/tipos';

export type FilaCsv = Record<string, string>;

const LINK_LICITACION = 'https://www.mercadopublico.cl/fichaLicitacion.html?idLicitacion=';
const LINK_OC = 'https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=';

function bigint(valor: string | undefined): bigint | null {
  const t = texto(valor);
  return t && /^\d+$/.test(t) ? BigInt(t) : null;
}

// ─── Órdenes de compra (oc-da) ──────────────────────────────────────────────

export interface FilaOcMapeada {
  orden: OrdenReg;
  item: ItemReg | null;
  empresas: EmpresaReg[];
}

/** Una fila del CSV de OC es una línea: la OC se repite en cada ítem. */
export function mapearFilaOc(f: FilaCsv): FilaOcMapeada | null {
  const id = bigint(f['ID']);
  const codigo = texto(f['Codigo']);
  if (!id || !codigo) return null;

  const compradorRut = normalizarRut(f['RutUnidadCompra']);
  const proveedorRut = normalizarRut(f['RutSucursal']);
  const esCompraAgil = siNo(f['EsCompraAgil']);
  // Las OC de compra ágil no traen CodigoLicitacion: el COT suele venir en el nombre.
  const codigoProceso =
    texto(f['CodigoLicitacion'])?.toUpperCase() ??
    (esCompraAgil ? codigoCompraAgilEnTexto(f['Nombre'], f['Descripcion/Obervaciones']) : null);

  const orden: OrdenReg = {
    id,
    codigo,
    link: LINK_OC + codigo,
    nombre: texto(f['Nombre'], 500),
    descripcion: texto(f['Descripcion/Obervaciones'], 4000),
    tipo: texto(f['Tipo']),
    procedencia: texto(f['ProcedenciaOC'], 300),
    esCompraAgil,
    esTratoDirecto: siNo(f['EsTratoDirecto']),
    estado: texto(f['Estado']),
    estadoProveedor: texto(f['EstadoProveedor']),
    fechaCreacion: fecha(f['FechaCreacion']),
    fechaEnvio: fecha(f['FechaEnvio']),
    fechaAceptacion: fecha(f['FechaAceptacion']),
    fechaCancelacion: fecha(f['FechaCancelacion']),
    montoTotal: decimal(f['MontoTotalOC']),
    moneda: texto(f['TipoMonedaOC']),
    montoTotalClp: decimal(f['MontoTotalOC_PesosChilenos']),
    compradorRut,
    unidadCompra: texto(f['UnidadCompra'], 300),
    codigoUnidadCompra: texto(f['CodigoUnidadCompra']),
    organismo: texto(f['OrganismoPublico'], 300),
    codigoOrganismo: texto(f['CodigoOrganismoPublico']),
    proveedorRut,
    proveedorNombre: texto(f['NombreProveedor'], 300),
    codigoProveedor: texto(f['CodigoProveedor']),
    procesoCodigo: codigoProceso,
    convenioMarco: texto(f['Codigo_ConvenioMarco']),
    formaPago: texto(f['FormaPago']),
    fuente: 'DATOS_ABIERTOS',
  };

  const idItem = bigint(f['IDItem']);
  const item: ItemReg | null = idItem
    ? {
        id: idItem,
        ordenCompraId: id,
        codigoProductoOnu: texto(f['codigoProductoONU']),
        producto: texto(f['NombreroductoGenerico'], 500),
        rubro: texto(f['RubroN1'], 300),
        especificacionComprador: texto(f['EspecificacionComprador'], 2000),
        especificacionProveedor: texto(f['EspecificacionProveedor'], 2000),
        cantidad: decimal(f['cantidad']),
        unidadMedida: texto(f['UnidadMedida']),
        precioNeto: decimal(f['precioNeto']),
        totalLineaNeto: decimal(f['totalLineaNeto']),
      }
    : null;

  const empresas: EmpresaReg[] = [];
  if (compradorRut) {
    empresas.push({
      rut: compradorRut,
      razonSocial: texto(f['OrganismoPublico'], 300),
      esOrganismo: true,
      esProveedor: false,
      codigoOrganismo: texto(f['CodigoOrganismoPublico']),
      sector: texto(f['sector']),
      actividad: texto(f['ActividadComprador'], 300),
      comuna: texto(f['CiudadUnidadCompra']),
      region: texto(f['RegionUnidadCompra']),
    });
  }
  if (proveedorRut) {
    empresas.push({
      rut: proveedorRut,
      razonSocial: texto(f['NombreProveedor'], 300),
      esOrganismo: false,
      esProveedor: true,
      codigoProveedor: texto(f['CodigoProveedor']),
      actividad: texto(f['ActividadProveedor'], 300),
      comuna: texto(f['ComunaProveedor']),
      region: texto(f['RegionProveedor']),
    });
  }
  return { orden, item, empresas };
}

// ─── Licitaciones (lic-da) ──────────────────────────────────────────────────

export interface FilaLicMapeada {
  proceso: ProcesoReg;
  oferta: OfertaReg | null;
  empresas: EmpresaReg[];
}

/** Una fila del CSV de licitaciones es ítem × oferta. */
export function mapearFilaLic(f: FilaCsv): FilaLicMapeada | null {
  const codigo = texto(f['CodigoExterno'])?.toUpperCase();
  if (!codigo) return null;
  const { tipo, codigoTipo } = tipoDesdeCodigo(codigo);
  const compradorRut = normalizarRut(f['RutUnidad']);

  const proceso: ProcesoReg = {
    codigo,
    tipo: tipo === 'OTRO' ? (f['CodigoTipo'] === '3' ? 'LICITACION_PRIVADA' : 'LICITACION_PUBLICA') : tipo,
    codigoTipo: codigoTipo ?? texto(f['Tipo']),
    idMp: bigint(f['Codigo']),
    nombre: texto(f['Nombre'], 500),
    descripcion: texto(f['Descripcion'], 4000),
    link: texto(f['Link']) ?? LINK_LICITACION + codigo,
    estado: texto(f['Estado']),
    compradorRut,
    codigoOrganismo: texto(f['CodigoOrganismo']),
    organismo: texto(f['NombreOrganismo'], 300),
    unidad: texto(f['NombreUnidad'], 300),
    region: texto(f['RegionUnidad']),
    fechaPublicacion: fecha(f['FechaPublicacion']),
    fechaCierre: fecha(f['FechaCierre']),
    fechaAdjudicacion: fecha(f['FechaAdjudicacion']),
    montoEstimado: decimal(f['MontoEstimado']),
    moneda: texto(f['CodigoMoneda']),
    numeroOferentes: entero(f['NumeroOferentes']),
    fuente: 'DATOS_ABIERTOS',
  };

  const proveedorRut = normalizarRut(f['RutProveedor']);
  const seleccionada = texto(f['Oferta seleccionada'])?.toLowerCase() === 'seleccionada';
  const cantidadAdjudicada = decimal(f['CantidadAdjudicada']);
  const montoUnitario = decimal(f['MontoUnitarioOferta']);
  const oferta: OfertaReg | null = proveedorRut
    ? {
        procesoCodigo: codigo,
        codigoItem: texto(f['Codigoitem']) ?? texto(f['Correlativo']) ?? '0',
        correlativo: entero(f['Correlativo']),
        producto: texto(f['Nombre producto genrico'] ?? f['Nombre producto genérico'], 500),
        proveedorRut,
        nombreOferta: texto(f['Nombre de la Oferta'], 500),
        estadoOferta: texto(f['Estado Oferta']),
        cantidadOfertada: decimal(f['Cantidad Ofertada']),
        montoUnitario,
        valorTotal: decimal(f['Valor Total Ofertado']),
        cantidadAdjudicada,
        montoAdjudicado:
          seleccionada && cantidadAdjudicada && montoUnitario
            ? (Number(cantidadAdjudicada) * Number(montoUnitario)).toFixed(2)
            : null,
        seleccionada,
        fechaEnvio: fecha(f['FechaEnvioOferta']),
      }
    : null;

  const empresas: EmpresaReg[] = [];
  if (compradorRut) {
    empresas.push({
      rut: compradorRut,
      razonSocial: texto(f['NombreOrganismo'], 300),
      esOrganismo: true,
      esProveedor: false,
      codigoOrganismo: texto(f['CodigoOrganismo']),
      sector: texto(f['sector']),
      comuna: texto(f['ComunaUnidad']),
      region: texto(f['RegionUnidad']),
    });
  }
  if (proveedorRut) {
    empresas.push({
      rut: proveedorRut,
      razonSocial: texto(f['RazonSocialProveedor'], 300) ?? texto(f['NombreProveedor'], 300),
      esOrganismo: false,
      esProveedor: true,
      codigoProveedor: texto(f['CodigoProveedor']),
    });
  }
  return { proceso, oferta, empresas };
}
