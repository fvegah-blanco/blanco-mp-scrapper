import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminKeyGuard, usuarioDe } from '../common/admin-key.guard';
import {
  type CronJobDefinition,
  CronRegistryService,
} from './cron-registry.service';
import { UpdateCronJobDto } from './dto/update-cron-job.dto';

function stripExecuteFn<T extends CronJobDefinition>(
  job: T,
): Omit<T, 'executeFn'> {
  const { executeFn, ...rest } = job;
  void executeFn;
  return rest;
}

/** Mismo contrato que /cron-jobs del back office: listar, historial, disparar, pausar y cambiar horario. */
@ApiTags('Cron Jobs')
@ApiHeader({ name: 'x-admin-key', required: false })
@UseGuards(AdminKeyGuard)
@Controller('cron-jobs')
export class CronManagementController {
  constructor(private readonly cronRegistry: CronRegistryService) {}

  @Get()
  async listJobs() {
    const jobs = await this.cronRegistry.listJobs();
    return { success: true, data: jobs.map(stripExecuteFn) };
  }

  @Get(':name/runs')
  getRunHistory(
    @Param('name') name: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.cronRegistry.getRunHistory(name, { page, limit });
  }

  /** Dispara el job sin esperar a que termine: los de ingesta tardan minutos. */
  @Post(':name/trigger')
  triggerJob(@Param('name') name: string) {
    if (this.cronRegistry.isRunning(name)) {
      return { success: false, message: 'Job is already running' };
    }
    void this.cronRegistry.runJob(name);
    return { success: true, message: 'Job disparado; ver /cron-jobs/:name/runs' };
  }

  @Patch(':name')
  async updateJob(
    @Param('name') name: string,
    @Body() dto: UpdateCronJobDto,
    @Req() req: Request,
  ) {
    if (dto.schedule && dto.resetSchedule) {
      throw new BadRequestException(
        'Cannot set schedule and resetSchedule simultaneously',
      );
    }

    const updatedBy = usuarioDe(req);

    if (dto.state === 'paused') {
      await this.cronRegistry.pauseJob(name, updatedBy);
    } else if (dto.state === 'active') {
      await this.cronRegistry.resumeJob(name, updatedBy);
    }

    if (dto.resetSchedule) {
      await this.cronRegistry.resetSchedule(name, updatedBy);
    } else if (dto.schedule) {
      await this.cronRegistry.updateSchedule(
        name,
        dto.schedule,
        dto.timeZone,
        updatedBy,
      );
    }

    const jobs = await this.cronRegistry.listJobs();
    const job = jobs.find((j) => j.name === name);
    return { success: true, data: stripExecuteFn(job!) };
  }
}
