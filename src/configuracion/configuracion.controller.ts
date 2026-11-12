import { Body, Controller, Delete, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminKeyGuard, usuarioDe } from '../common/admin-key.guard';
import { ConfiguracionService } from './configuracion.service';
import { CambiarParametroDto } from './dto/cambiar-parametro.dto';

/** Parámetros vivos de los crons: se aplican en la próxima ejecución, sin redeploy. */
@ApiTags('Configuración')
@ApiSecurity('x-admin-key')
@UseGuards(AdminKeyGuard)
@Controller('configuracion')
export class ConfiguracionController {
  constructor(private readonly configuracion: ConfiguracionService) {}

  @ApiOperation({ summary: 'Lista los parámetros con su valor actual y el de por defecto' })
  @Get()
  async listar() {
    return { success: true, data: await this.configuracion.listar() };
  }

  @ApiOperation({ summary: 'Cambia el valor de un parámetro' })
  @Patch(':clave')
  async cambiar(@Param('clave') clave: string, @Body() body: CambiarParametroDto, @Req() req: Request) {
    await this.configuracion.set(clave, body.valor, usuarioDe(req));
    return { success: true, data: { clave, valor: body.valor } };
  }

  @ApiOperation({ summary: 'Vuelve un parámetro a su valor por defecto' })
  @Delete(':clave')
  async restablecer(@Param('clave') clave: string) {
    await this.configuracion.restablecer(clave);
    return { success: true, data: { clave } };
  }
}
