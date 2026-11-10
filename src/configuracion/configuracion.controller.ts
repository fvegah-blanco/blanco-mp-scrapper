import { Body, Controller, Delete, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminKeyGuard, usuarioDe } from '../common/admin-key.guard';
import { ConfiguracionService } from './configuracion.service';

@ApiTags('Configuración')
@ApiHeader({ name: 'x-admin-key', required: false })
@UseGuards(AdminKeyGuard)
@Controller('configuracion')
export class ConfiguracionController {
  constructor(private readonly configuracion: ConfiguracionService) {}

  @Get()
  async listar() {
    return { success: true, data: await this.configuracion.listar() };
  }

  /** Body: { "valor": <number|boolean> } */
  @Patch(':clave')
  async cambiar(@Param('clave') clave: string, @Body() body: { valor: unknown }, @Req() req: Request) {
    await this.configuracion.set(clave, body?.valor, usuarioDe(req));
    return { success: true };
  }

  @Delete(':clave')
  async restablecer(@Param('clave') clave: string) {
    await this.configuracion.restablecer(clave);
    return { success: true };
  }
}
