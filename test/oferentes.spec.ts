import { esAnexoIdentificacion } from '../src/common/anexo1';
import { extraerContactos } from '../src/extraccion/contactos.extractor';
import { parsearGrilla, parsearOferentes } from '../src/mercado-publico/ofertas.client';

describe('Anexo N°1 del oferente', () => {
  it('reconoce el nombre y el título', () => {
    for (const n of ['ANEXO_N°1.pdf', 'Anexo_1.pdf', '1._Anexo_N°1.pdf', 'ANEXO_NÂ°1.pdf', 'ANEXO_1_Identificacion_Oferente.pdf', 'anexo-01.docx']) {
      expect(esAnexoIdentificacion(n)).toBe(true);
    }
    expect(esAnexoIdentificacion('ANEXO_N°10.pdf')).toBe(false);
    expect(esAnexoIdentificacion('Patente_2026.pdf')).toBe(false);
    expect(esAnexoIdentificacion('documento.pdf', 'FORMULARIO IDENTIFICACIÓN DEL OFERENTE\nRazón social')).toBe(true);
  });
});

describe('cuadro de ofertas', () => {
  it('lee oferentes y sus botones de anexos', () => {
    const html = `<table><tr>
      <td><input type="image" id="grd_ctl02_GvImgFirma" onclick="ver_declaracion('77.143.365-0'); return false;" /></td>
      <td>FRIODURAN SPA</td>
      <td><span id="grd_ctl02_EstadoOferta">Aceptada</span></td>
      <td><input type="image" title="Anexos Administrativos" onclick="openPopUp('ViewBidAttachment.aspx?enc=abc','x')" />
          <input type="image" title="Anexos Técnicos" onclick="openPopUp('ViewBidAttachment.aspx?enc=def','x')" /></td>
    </tr></table>`;
    expect(parsearOferentes(html)).toEqual([{
      rut: '77.143.365-0',
      proveedor: 'FRIODURAN SPA',
      estado: 'Aceptada',
      botones: { 'Anexos Administrativos': 'ViewBidAttachment.aspx?enc=abc', 'Anexos Técnicos': 'ViewBidAttachment.aspx?enc=def' },
    }]);
  });

  it('lee la grilla de adjuntos y su paginación (comillas HTML-encoded)', () => {
    const html = `<form><input type="hidden" name="__VIEWSTATE" value="VS" />
      <table id="DWNL_grdId">
        <tr><td><span id="DWNL_grdId_ctl02_File">Anexo_1.pdf</span><span id="DWNL_grdId_ctl02_Type">Anexo</span>
          <input type="image" id="DWNL_grdId_ctl02_search" name="DWNL$grdId$ctl02$search" /></td></tr>
        <tr><td><a href="javascript:__doPostBack(&#39;DWNL$grdId&#39;,&#39;Page$2&#39;)">2</a>
          <a href="javascript:__doPostBack(&#39;DWNL$grdId&#39;,&#39;Page$3&#39;)">3</a></td></tr>
      </table></form>`;
    const g = parsearGrilla(html);
    expect(g.filas.map((f) => [f.archivo, f.boton])).toEqual([['Anexo_1.pdf', 'DWNL$grdId$ctl02$search']]);
    expect(g.paginas).toEqual([2, 3]);
    expect(g.ocultos.__VIEWSTATE).toBe('VS');
  });
});

describe('extractor en documentos del oferente', () => {
  const ctx = { compradorRut: '61102014-7', compradorNombre: 'DIRECTEMAR', proveedores: [], duenoRut: '76218919-4' };

  it('correo con tilde y teléfono partido en dos líneas', () => {
    const texto = 'número telefónico (+56) 2 2719 \n5957 o correo electrónico a la siguiente dirección: atenciónalcliente@hispasat.com';
    const [c] = extraerContactos(texto, ctx);
    expect(c.email).toBe('atencionalcliente@hispasat.com');
    expect(c.telefono).toBe('+56227195957');
    // Sin otra señal, en un documento del oferente queda como del oferente.
    expect(c).toMatchObject({ rol: 'PROVEEDOR', rut: '76218919-4', confianza: 0.5 });
  });
});
