import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';

/** Sin llave: lo usa el healthcheck del despliegue. */
@ApiTags('Salud')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({ summary: 'Responde si la app y la base están arriba' })
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { success: true, data: { ok: true } };
  }
}
