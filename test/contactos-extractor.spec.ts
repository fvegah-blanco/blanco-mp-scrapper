import { extraerContactos, type ContextoProceso } from '../src/extraccion/contactos.extractor';

const CTX: ContextoProceso = {
  compradorRut: '69072100-7',
  compradorNombre: 'I MUNICIPALIDAD DE PUENTE ALTO',
  proveedores: [
    { rut: '77300592-3', nombre: 'GRUPO STALC SPA', adjudicado: true },
    { rut: '76124915-0', nombre: 'H. MOTORES S.A.', adjudicado: false },
  ],
};

describe('extractor de contactos', () => {
  it('asigna por RUT cercano', () => {
    const texto = `ANEXO N°1 IDENTIFICACIÓN DEL OFERENTE
      Razón social: Grupo Stalc SpA   RUT: 77.300.592-3
      Nombre: Juan Pérez Soto   Teléfono: +56 9 8765 4321   Correo: jperez@stalc.cl`;
    const [c] = extraerContactos(texto, CTX);
    expect(c).toMatchObject({ rol: 'PROVEEDOR', rut: '77300592-3', email: 'jperez@stalc.cl', telefono: '+56987654321', confianza: 0.9 });
    expect(c.nombre).toBe('Juan Pérez Soto');
  });

  it('asigna al comprador por dominio institucional', () => {
    const [c] = extraerContactos('Consultas al correo adquisiciones@mpuentealto.cl', CTX);
    expect(c).toMatchObject({ rol: 'COMPRADOR', rut: '69072100-7' });
  });

  it('usa palabras de contexto cuando no hay RUT ni dominio', () => {
    const texto = 'La contraparte técnica será la Sra. Ana Rojas, fono 22 576 7296, correo arojas@otrodominio.cl';
    const [c] = extraerContactos(texto, CTX);
    expect(c.rol).toBe('COMPRADOR');
    expect(c.telefono).toBe('+56225767296');
  });

  it('ignora correos de Mercado Público y montos con puntos', () => {
    const texto = 'Reclamos en soporte@mercadopublico.cl. Monto total $ 1.234.567. RUT 77.300.592-3';
    expect(extraerContactos(texto, CTX)).toEqual([]);
  });

  it('dominio parecido al proveedor', () => {
    const [c] = extraerContactos('Enviar factura a facturacion@hmotores.cl', CTX);
    expect(c).toMatchObject({ rol: 'PROVEEDOR', rut: '76124915-0' });
  });
});
