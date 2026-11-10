import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsBoolean } from 'class-validator';
import { IsCronExpression } from '../validators/is-cron-expression.validator';

export class UpdateCronJobDto {
  @ApiPropertyOptional({ enum: ['active', 'paused'] })
  @IsOptional()
  @IsIn(['active', 'paused'])
  state?: 'active' | 'paused';

  @ApiPropertyOptional({
    description: 'Cron expression to override the default schedule',
    example: '*/10 * * * *',
  })
  @IsOptional()
  @IsString()
  @IsCronExpression()
  schedule?: string;

  @ApiPropertyOptional({
    description: 'IANA timezone for the schedule override',
    example: 'America/Santiago',
  })
  @IsOptional()
  @IsString()
  timeZone?: string;

  @ApiPropertyOptional({
    description: 'Reset schedule to the code-defined default',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  resetSchedule?: boolean;
}
