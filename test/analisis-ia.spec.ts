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
  razon_social: 'PV EQUIP S.A.',
  rut_empresa: '79.895.670-1',
  contactos: [
    { rol: 'contacto', nombre: 'GIOVANI JORQUERA', cargo: 'REPRESENTANTE DE VENTAS', telefono: '998714229', email: 'giovani.jorquera@pvequip.cl', rut: '' },
    { rol: 'otro', nombre: 'PV EQUIP S.A.', cargo: '', telefono: '223677800', email: 'clientes@pvequip.cl', rut: '' },
    { rol: 'comprador', nombre: 'Ana', cargo: '', telefono: '', email: 'ana@hospital.cl', rut: '' },
  ],
};

describe('contactos desde la respuesta de Bedrock', () => {
  it('asigna rol, RUT y confianza', async () => {
    const texto = 'giovani.jorquera@pvequip.cl clientes@pvequip.cl ana@hospital.cl '.repeat(10);
    const r = await servicio().contactosDe(doc(texto), analisis);
    expect(r.map((c) => [c.rol, c.rut, c.confianza, c.nombre])).toEqual([
      ['PROVEEDOR', '79895670-1', 0.9, 'GIOVANI JORQUERA'],
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
});
