import { parsearFichaOc } from '../src/mercado-publico/ficha-oc.client';
import { contactosDeFichaOc, imagenesOfuscadas, stringsDelViewState } from '../src/mercado-publico/viewstate';

/** Arma un ViewState de juguete con strings con prefijo de largo (0x05 + largo 7-bit). */
function viewState(strings: string[]): string {
  const partes: Buffer[] = [Buffer.from([0xff, 0x01, 0x0f])];
  for (const s of strings) {
    const b = Buffer.from(s, 'utf8');
    const largo: number[] = [];
    let n = b.length;
    do {
      let byte = n & 0x7f;
      n >>= 7;
      if (n) byte |= 0x80;
      largo.push(byte);
    } while (n);
    partes.push(Buffer.from([0x05, ...largo]), b, Buffer.from([0x64, 0x64]));
  }
  return Buffer.concat(partes).toString('base64');
}

const STRINGS = [
  '2 .- Datos del Comprador', 'Nombre Completo', 'NOMBRE APELLIDO', 'Cargo', 'Teléfono', '56-2-25767296', 'Fax', 'E-mail',
  'nombre.apellido@hospitalejemplo.cl', '../../../Procurement/Modules/Tools/ImgOfuscar.aspx?qs=abc_DEF-1',
  '3 .- Datos de Pago y Facturación', 'Contacto del Proveedor', 'Nombre Proveedor', 'Cargo', 'Representante Legal', 'Teléfono', 'Fax',
  'E-mail', 'contacto@proveedorejemplo.cl', 'Ver listado', '6 .- Productos/Servicios',
];

describe('ViewState de la ficha de OC', () => {
  it('extrae los strings en orden', () => {
    expect(stringsDelViewState(viewState(['uno', 'dos', 'Teléfono']))).toEqual(['uno', 'dos', 'Teléfono']);
  });

  it('lee el contacto del comprador y del proveedor', () => {
    const { comprador, proveedor } = contactosDeFichaOc(stringsDelViewState(viewState(STRINGS)));
    expect(comprador).toEqual({ nombre: 'NOMBRE APELLIDO', cargo: null, telefono: '56-2-25767296', fax: null, email: 'nombre.apellido@hospitalejemplo.cl' });
    expect(proveedor).toEqual({ nombre: 'Nombre Proveedor', cargo: 'Representante Legal', telefono: null, fax: null, email: 'contacto@proveedorejemplo.cl' });
  });

  it('proveedor sin datos públicos', () => {
    const s = ['Contacto del Proveedor', 'Cargo', 'Contacto', 'Teléfono', 'Fax', 'E-mail', 'Esta información aún no se encuentra disponible.', 'Ver listado'];
    expect(contactosDeFichaOc(s).proveedor).toBeNull();
  });

  it('URLs de imágenes ofuscadas', () => {
    expect(imagenesOfuscadas(STRINGS)).toEqual(['https://www.mercadopublico.cl/Procurement/Modules/Tools/ImgOfuscar.aspx?qs=abc_DEF-1']);
  });

  it('parsea la ficha completa: RUTs, licitación de origen y contactos', () => {
    const html = `<html><body>
      <input type="hidden" id="__VIEWSTATE" value="${viewState(STRINGS)}" />
      <span id="lblStatusPOValue">Aceptada</span><span id="lblBuyerTaxIDValue">61.107.000-4</span>
      <span id="lblRutValueP">76.573.521-1</span><span id="lblNotesValue">Según licitación 948356-41-LE26</span>
    </body></html>`;
    const f = parsearFichaOc('948356-4204-SE26', html);
    expect(f.compradorRut).toBe('61107000-4');
    expect(f.proveedorRut).toBe('76573521-1');
    expect(f.procesoCodigo).toBe('948356-41-LE26');
    expect(f.comprador?.email).toBe('nombre.apellido@hospitalejemplo.cl');
    expect(f.proveedor?.nombre).toBe('Nombre Proveedor');
  });
});
