import { codigoCompraAgilEnTexto } from '../src/common/codigos';
import { decimal, fecha, hoyChile, texto } from '../src/common/parse';
import { normalizarRut, rutValido } from '../src/common/rut';
import { claveContacto, normalizarEmail, normalizarTelefono } from '../src/ingesta/contactos.repository';
import { tipoDesdeCodigo } from '../src/ingesta/tipos';
import { decodificarRfc2047 } from '../src/mercado-publico/adjuntos.client';
import { palabrasClave, prefijoUnidad, tipoOcDesdeCodigo } from '../src/tiempo-real/palabras';

describe('rut', () => {
  it('normaliza con y sin puntos', () => {
    expect(normalizarRut('76.573.521-1')).toBe('76573521-1');
    expect(normalizarRut('61107000-4')).toBe('61107000-4');
    expect(normalizarRut('5.126.663-k')).toBe('5126663-K');
    expect(normalizarRut('NA')).toBeNull();
  });
  it('valida el dígito verificador', () => {
    expect(rutValido('76.573.521-1')).toBe(true);
    expect(rutValido('76.573.521-2')).toBe(false);
  });
});

describe('parse', () => {
  it('lee montos chilenos y vacíos', () => {
    expect(decimal('118588323,07')).toBe('118588323.07');
    expect(decimal('1.234.567,5')).toBe('1234567.5');
    expect(decimal('382614')).toBe('382614');
    expect(decimal('NA')).toBeNull();
    expect(texto('  NA ')).toBeNull();
  });
  it('lee fechas en hora de Chile', () => {
    // Noviembre: Chile en horario de verano (UTC-3).
    expect(fecha('2026-11-03')?.toISOString()).toBe('2026-11-03T03:00:00.000Z');
    expect(fecha('10-11-2026 13:19:59')?.toISOString()).toBe('2026-11-10T16:19:59.000Z');
    // Julio: invierno (UTC-4).
    expect(fecha('2026-07-01 10:00')?.toISOString()).toBe('2026-07-01T14:00:00.000Z');
    expect(fecha('1900-01-01')).toBeNull();
  });
  it('fecha local de hoy', () => {
    expect(hoyChile(0, new Date('2026-11-10T02:00:00Z'))).toBe('2026-11-09');
  });
});

describe('códigos de proceso', () => {
  it('detecta el tipo por la sigla', () => {
    expect(tipoDesdeCodigo('799512-11-LE26')).toEqual({ tipo: 'LICITACION_PUBLICA', codigoTipo: 'LE' });
    expect(tipoDesdeCodigo('4127-89-I225')).toEqual({ tipo: 'LICITACION_PRIVADA', codigoTipo: 'I2' });
    expect(tipoDesdeCodigo('1196-63-COT26')).toEqual({ tipo: 'COMPRA_AGIL', codigoTipo: 'COT' });
    expect(tipoDesdeCodigo('948356-41-CO26')).toEqual({ tipo: 'LICITACION_PRIVADA', codigoTipo: 'CO' });
  });
  it('saca el COT del nombre de la OC', () => {
    expect(codigoCompraAgilEnTexto('Orden de Compra generada por invitación a compra ágil: 3485-1129-COT26')).toBe('3485-1129-COT26');
    expect(codigoCompraAgilEnTexto('ADQUISICION DE CINTILLO / 2098-766-cot26')).toBe('2098-766-COT26');
    expect(codigoCompraAgilEnTexto('PM 884 ROPA DE PROTECCION', null, 'ver 1955-47-COT26')).toBe('1955-47-COT26');
    expect(codigoCompraAgilEnTexto('ADQUISICION ELECTROCARDIOGRAFO.')).toBeNull();
  });
  it('palabras clave y prefijo de unidad', () => {
    expect(palabrasClave('ADQUISICION ELECTROCARDIOGRAFO.')).toBe('ELECTROCARDIOGRAFO');
    expect(palabrasClave('PM 884 O/C N° 884  ROPA DE PROTECCION SEGURIDAD CIUDADANA.')).toBe('ROPA PROTECCION SEGURIDAD CIUDADANA');
    expect(prefijoUnidad('1196-267-AG26')).toBe('1196');
    expect(tipoOcDesdeCodigo('1196-267-AG26')).toBe('AG');
    expect(tipoOcDesdeCodigo('898-3712-CM26')).toBe('CM');
  });
});

describe('contacto', () => {
  it('normaliza teléfonos chilenos', () => {
    expect(normalizarTelefono('56-2-25767296')).toBe('+56225767296');
    expect(normalizarTelefono('+56 9 8765 4321')).toBe('+56987654321');
    expect(normalizarTelefono('(2) 2576 7296')).toBe('+56225767296');
    expect(normalizarTelefono('23525671')).toBe('+56223525671');
    expect(normalizarTelefono('56-2-3525671')).toBe('+56223525671');
    expect(normalizarTelefono('12345')).toBeNull();
  });
  it('la misma persona con y sin teléfono tiene la misma clave', () => {
    expect(claveContacto('1-9', 'PROVEEDOR', 'a@b.cl', null)).toBe(claveContacto('1-9', 'PROVEEDOR', 'a@b.cl', '+56912345678'));
    expect(claveContacto('1-9', 'PROVEEDOR', null, '+56912345678')).toBe('1-9|PROVEEDOR|tel:+56912345678');
    expect(claveContacto('1-9', 'PROVEEDOR', null, null, 'José  Pérez')).toBe('1-9|PROVEEDOR|nombre:jose perez');
  });
  it('normaliza correos', () => {
    expect(normalizarEmail(' Hector.Villar@HospitalLaFlorida.cl ')).toBe('hector.villar@hospitallaflorida.cl');
    expect(normalizarEmail('no es correo')).toBeNull();
  });
  it('decodifica nombres RFC 2047 del servidor de adjuntos', () => {
    const b64 = Buffer.from('ANEXO_Y_DISPOSICIONES.pdf').toString('base64');
    expect(decodificarRfc2047(`=?utf-8?B?${b64}?=`)).toBe('ANEXO_Y_DISPOSICIONES.pdf');
  });
});
