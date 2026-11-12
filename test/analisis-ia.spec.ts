import type { Documento } from '@prisma/client';
import { AnalisisIaService, type AnalisisAnexo } from '../src/extraccion/analisis-ia.service';

function servicio() {
  const prisma = { proceso: { findUnique: jest.fn().mockResolvedValue({ compradorRut: '61102014-7' }) } };
  return new AnalisisIaService({} as never, prisma as never, {} as never, {} as never, {} as never, {} as never);
}

const doc = (texto: string | null, proveedorRut: string | null = '79895670-1') =>
  ({ id: 'd1', procesoCodigo: '1-1-LE26', nombre: 'Anexo_1.pdf', texto, proveedorRut }) as Documento;

const analisis: AnalisisAnexo = {
  es_anexo_identificacion: true,
  razon_social: 'PROVEEDOR EJEMPLO S.A.',
  rut_empresa: '79.895.670-1',
  contactos: [
    { rol: 'contacto', nombre: 'JUAN EJEMPLO', cargo: 'REPRESENTANTE DE VENTAS', telefono: '912345678', email: 'juan.ejemplo@proveedorejemplo.cl', rut: '' },
    { rol: 'otro', nombre: 'PROVEEDOR EJEMPLO S.A.', cargo: '', telefono: '221234567', email: 'clientes@proveedorejemplo.cl', rut: '' },
    { rol: 'comprador', nombre: 'Ana', cargo: '', telefono: '', email: 'ana@hospital.cl', rut: '' },
  ],
};

describe('contactos desde la respuesta de Bedrock', () => {
  it('asigna rol, RUT y confianza', async () => {
    const texto = 'juan.ejemplo@proveedorejemplo.cl clientes@proveedorejemplo.cl ana@hospital.cl '.repeat(10);
    const r = await servicio().contactosDe(doc(texto), analisis);
    expect(r.map((c) => [c.rol, c.rut, c.confianza, c.nombre])).toEqual([
      ['PROVEEDOR', '79895670-1', 0.9, 'JUAN EJEMPLO'],
      ['PROVEEDOR', '79895670-1', 0.7, null],
      ['COMPRADOR', '61102014-7', 0.8, 'Ana'],
    ]);
    expect(r.every((c) => c.fuente === 'DOCUMENTO_IA')).toBe(true);
  });

  it('baja la confianza si el correo no aparece en el texto', async () => {
    const [c] = await servicio().contactosDe(doc('texto sin el correo '.repeat(20)), analisis);
    expect(c.confianza).toBe(0.65);
  });

  it('sin texto (escaneo) confía en la visión', async () => {
    const [c] = await servicio().contactosDe(doc(null), analisis);
    expect(c.confianza).toBe(0.9);
  });

  it('de una lista de referencias solo guarda el representante legal', async () => {
    const referencias = Array.from({ length: 8 }, (_, i) => ({ rol: 'contacto' as const, nombre: `Cliente ${i}`, cargo: '', telefono: '', email: `c${i}@municipio.cl`, rut: '' }));
    const r = await servicio().contactosDe(doc(null), {
      ...analisis,
      contactos: [...referencias, { rol: 'representante_legal', nombre: 'PEDRO EJEMPLO', cargo: '', telefono: '', email: '', rut: '11111111-1' }],
    });
    expect(r.map((c) => c.nombre)).toEqual(['PEDRO EJEMPLO']);
  });

  it('descarta un comprador sin correo institucional', async () => {
    const r = await servicio().contactosDe(doc(null), {
      ...analisis,
      contactos: [
        { rol: 'comprador', nombre: 'PEDRO EJEMPLO', cargo: '', telefono: '+56912345678', email: '', rut: '' },
        { rol: 'comprador', nombre: 'Solicitante', cargo: '', telefono: '', email: 'unidad@gmail.com', rut: '' },
        { rol: 'comprador', nombre: 'Ana', cargo: '', telefono: '', email: 'ana@redsalud.gob.cl', rut: '' },
      ],
    });
    expect(r.map((c) => c.nombre)).toEqual(['Ana']);
  });

  it('sin correo ni teléfono guarda solo al representante legal del oferente', async () => {
    const r = await servicio().contactosDe(doc(null), {
      ...analisis,
      contactos: [
        { rol: 'representante_legal', nombre: 'Rep Propio', cargo: '', telefono: '', email: '', rut: '' },
        { rol: 'contacto', nombre: 'Sin Datos', cargo: '', telefono: '', email: '', rut: '' },
      ],
    });
    expect(r.map((c) => c.nombre)).toEqual(['Rep Propio']);
    const tercero = await servicio().contactosDe(doc(null), { ...analisis, rut_empresa: '78.370.360-2', contactos: [{ rol: 'representante_legal', nombre: 'Lab Tercero', cargo: '', telefono: '', email: '', rut: '' }] });
    expect(tercero).toEqual([]);
  });
});
