import { ApiPropertyOptional } from '@nestjs/swagger';
import { RolContacto, TipoProceso } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PaginacionDto } from '../../common/paginacion.dto';

export class GastoIaQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365, description: 'Días hacia atrás' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  dias: number = 30;
}

export class AdjudicacionesQueryDto extends PaginacionDto {
  @ApiPropertyOptional({ enum: TipoProceso })
  @IsOptional()
  @IsEnum(TipoProceso)
  tipo?: TipoProceso;

  @ApiPropertyOptional({ description: 'RUT del comprador o del proveedor' })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  rut?: string;

  @ApiPropertyOptional({ description: 'Detectadas desde esta fecha (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  desde?: Date;
}

export class ContactosQueryDto extends PaginacionDto {
  @ApiPropertyOptional({ enum: RolContacto })
  @IsOptional()
  @IsEnum(RolContacto)
  rol?: RolContacto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(15)
  rut?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minConfianza?: number;
}
