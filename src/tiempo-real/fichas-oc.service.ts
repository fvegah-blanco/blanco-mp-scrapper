import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { getErrorMessage } from '../common/errores';
import { enParalelo } from '../common/http';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { OcrService } from '../extraccion/ocr.service';
import { type ContactoReg, ContactosRepository, normalizarEmail } from '../ingesta/contactos.repository';
import { IngestaRepository } from '../ingesta/ingesta.repository';
import { FichaOcClient } from '../mercado-publico/ficha-oc.client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Lee la ficha pública de cada OC nueva: el contacto del comprador (nombre,
 * cargo, teléfono, correo) que viene en el ViewState, y la licitación de origen
 * de las OC tipo SE/CC, que el buscador no informa. Si el ViewState no trae el
 * correo, se intenta con OCR sobre la imagen ofuscada.
 */
@Injectable()
export class FichasOcService {
  constructor(
    @InjectPinoLogger(FichasOcService.name) private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    private readonly fichas: FichaOcClient,
    private readonly ocr: OcrService,
    private readonly contactos: ContactosRepository,
    private readonly ingesta: IngestaRepository,
    private readonly configuracion: ConfiguracionService,
  ) {}

  /** Lote de OC sin ficha leída (o las indicadas). */
  async procesar(ids?: bigint[]): Promise<{ leidas: number; contactos: number; procesos: number; fallidas: number }> {
    const lote = await this.configuracion.get('fichas_oc.lote');
    const soloTiempoReal = await this.configuracion.get('fichas_oc.solo_tiempo_real');
    const ordenes = await this.prisma.ordenCompra.findMany({
      where: ids
        ? { id: { in: ids }, fichaRevisadaAt: null }
        : { fichaRevisadaAt: null, ...(soloTiempoReal ? { fuente: 'BUSCADOR' as const } : {}) },
      orderBy: { fechaEnvio: 'desc' },
      take: lote,
      select: { id: true, codigo: true, tipo: true, compradorRut: true, proveedorRut: true, procesoCodigo: true, montoTotalClp: true },
    });

    let contactos = 0;
    let procesos = 0;
    let fallidas = 0;
    await enParalelo(ordenes, 4, async (oc) => {
      try {
        const ficha = await this.fichas.leer(oc.codigo);
        const regs: ContactoReg[] = [];
        const compradorRut = oc.compradorRut ?? ficha.compradorRut;
        if (ficha.comprador) {
          regs.push({
            rut: compradorRut, rol: 'COMPRADOR', nombre: ficha.comprador.nombre, cargo: ficha.comprador.cargo,
            email: ficha.comprador.email, telefono: ficha.comprador.telefono, fuente: 'FICHA_OC', ordenCompraId: oc.id,
            evidencia: `Ficha OC ${oc.codigo}: contacto de la unidad de compra`, confianza: 0.95,
          });
        }
        if (ficha.proveedor) {
          regs.push({
            rut: oc.proveedorRut ?? ficha.proveedorRut, rol: 'PROVEEDOR', nombre: ficha.proveedor.nombre, cargo: ficha.proveedor.cargo,
            email: ficha.proveedor.email, telefono: ficha.proveedor.telefono, fuente: 'FICHA_OC', ordenCompraId: oc.id,
            evidencia: `Ficha OC ${oc.codigo}: contacto del proveedor`, confianza: 0.95,
          });
        }
        if (!ficha.comprador?.email && ficha.imagenes.length) {
          const email = await this.correoPorOcr(ficha.imagenes[0]);
          if (email) {
            regs.push({ rut: compradorRut, rol: 'COMPRADOR', email, fuente: 'FICHA_OC', ordenCompraId: oc.id, evidencia: `OCR de la imagen ofuscada de la OC ${oc.codigo}`, confianza: 0.8 });
          }
        }
        contactos += await this.contactos.guardar(regs);

        // Licitación de origen (no aplica a convenio marco: ahí el código es el del convenio).
        const procesoCodigo = oc.procesoCodigo ?? (oc.tipo !== 'CM' && oc.tipo !== 'AG' ? ficha.procesoCodigo : null);
        await this.prisma.ordenCompra.update({
          where: { id: oc.id },
          data: { fichaRevisadaAt: new Date(), fichaError: null, ...(procesoCodigo && !oc.procesoCodigo ? { procesoCodigo } : {}) },
        });
        if (procesoCodigo && !oc.procesoCodigo && (oc.proveedorRut ?? ficha.proveedorRut)) {
          await this.registrarAdjudicacion(procesoCodigo, (oc.proveedorRut ?? ficha.proveedorRut)!, oc.id, oc.montoTotalClp?.toString() ?? null, compradorRut);
          procesos++;
        }
      } catch (error) {
        fallidas++;
        await this.prisma.ordenCompra.update({
          where: { id: oc.id },
          data: { fichaRevisadaAt: new Date(), fichaError: getErrorMessage(error).slice(0, 500) },
        });
      }
    });
    if (ordenes.length) this.logger.info({ leidas: ordenes.length, contactos, procesos, fallidas }, 'Fichas de OC leídas');
    return { leidas: ordenes.length, contactos, procesos, fallidas };
  }

  async registrarAdjudicacion(procesoCodigo: string, proveedorRut: string, ocId: bigint, monto: string | null, compradorRut: string | null) {
    await this.ingesta.asegurarProcesos([{ codigo: procesoCodigo, compradorRut }]);
    const nuevas = await this.ingesta.upsertAdjudicaciones([
      { procesoCodigo, proveedorRut, ordenCompraId: ocId, monto, origen: 'ORDEN_COMPRA' },
    ]);
    if (nuevas.length && (await this.configuracion.get('adjuntos.auto_encolar_adjudicados'))) {
      await this.ingesta.encolarAdjuntos([procesoCodigo]);
    }
  }

  private async correoPorOcr(url: string): Promise<string | null> {
    try {
      const texto = await this.ocr.reconocer(await this.fichas.imagen(url));
      // El OCR confunde a veces "@" con "©" o deja espacios.
      const limpio = texto.replace(/\s+/g, '').replace(/[©®]/g, '@');
      return normalizarEmail(limpio.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0]);
    } catch {
      return null;
    }
  }
}
