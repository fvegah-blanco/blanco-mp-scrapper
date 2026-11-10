import { mapearFilaLic, mapearFilaOc } from '../src/datos-abiertos/mapeo';

describe('mapeo de CSV de datos abiertos', () => {
  it('fila de OC de compra ágil: COT desde el nombre, comprador y proveedor', () => {
    const m = mapearFilaOc({
      ID: '55826578', Codigo: '1196-267-AG26', Nombre: 'Orden de Compra generada por invitación a compra ágil: 1196-63-COT26',
      'Descripcion/Obervaciones': 'NA', Tipo: 'AG', EsCompraAgil: 'Si', EsTratoDirecto: 'No', Estado: 'Enviada a proveedor',
      FechaEnvio: '2026-11-10', MontoTotalOC: '3349850', TipoMonedaOC: 'CLP', MontoTotalOC_PesosChilenos: '3349850',
      RutUnidadCompra: '61.107.000-4', UnidadCompra: 'I.ND. REGION I', CodigoOrganismoPublico: '7248', OrganismoPublico: 'INSTITUTO NACIONAL DE DEPORTES DE CHILE',
      RutSucursal: '76.573.521-1', NombreProveedor: 'DISPOSITIVOS MEDICOS SPA', CodigoProveedor: '893469', CodigoLicitacion: '',
      IDItem: '147307622', cantidad: '1', precioNeto: '2815000', totalLineaNeto: '2815000', Codigo_ConvenioMarco: 'NA',
    })!;
    expect(m.orden.id).toBe(55826578n);
    expect(m.orden.procesoCodigo).toBe('1196-63-COT26');
    expect(m.orden.esCompraAgil).toBe(true);
    expect(m.orden.compradorRut).toBe('61107000-4');
    expect(m.orden.proveedorRut).toBe('76573521-1');
    expect(m.orden.convenioMarco).toBeNull();
    expect(m.item?.id).toBe(147307622n);
    expect(m.empresas.map((e) => [e.rut, e.esOrganismo, e.esProveedor])).toEqual([
      ['61107000-4', true, false],
      ['76573521-1', false, true],
    ]);
  });

  it('fila de OC de licitación usa CodigoLicitacion', () => {
    const m = mapearFilaOc({ ID: '1', Codigo: '2423-1168-SE24', CodigoLicitacion: '2423-72-lp24', EsCompraAgil: 'No', Nombre: 'X 1-1-COT26' })!;
    expect(m.orden.procesoCodigo).toBe('2423-72-LP24');
  });

  it('fila de licitación con oferta seleccionada', () => {
    const m = mapearFilaLic({
      Codigo: '9644616', CodigoExterno: '799512-11-LE26', Link: 'http://www.mercadopublico.cl/fichaLicitacion.html?idLicitacion=799512-11-LE26',
      Nombre: 'Mantención', Estado: 'Adjudicada', CodigoTipo: '1', Tipo: 'LE', RutUnidad: '70.859.400-8', NombreOrganismo: 'MUNICIPALIDAD',
      FechaPublicacion: '2026-10-05', FechaAdjudicacion: '2026-11-02', MontoEstimado: '10500000', NumeroOferentes: '3',
      Codigoitem: '43348694', Correlativo: '1', RutProveedor: '77.143.365-0', RazonSocialProveedor: 'FRIODURAN SPA',
      'Oferta seleccionada': 'Seleccionada', 'Estado Oferta': 'Aceptada', CantidadAdjudicada: '2', MontoUnitarioOferta: '1500000,5',
    })!;
    expect(m.proceso.tipo).toBe('LICITACION_PUBLICA');
    expect(m.proceso.idMp).toBe(9644616n);
    expect(m.oferta?.seleccionada).toBe(true);
    expect(m.oferta?.montoAdjudicado).toBe('3000001.00');
    expect(m.oferta?.proveedorRut).toBe('77143365-0');
  });

  it('fila sin código se descarta', () => {
    expect(mapearFilaOc({ ID: '', Codigo: '' })).toBeNull();
    expect(mapearFilaLic({ CodigoExterno: 'NA' })).toBeNull();
  });
});
