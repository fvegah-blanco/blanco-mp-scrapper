import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsOptional, Matches } from 'class-validator';
import { RE_CODIGO_MP } from '../../common/codigo-mp.pipe';

export class EncolarDto {
  @ApiProperty({ example: ['799512-11-LE26', '1196-63-COT26'], description: 'Hasta 500 códigos de proceso' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @Transform(({ value }) => (Array.isArray(value) ? value.map((c: unknown) => (typeof c === 'string' ? c.trim().toUpperCase() : c)) : value))
  @Matches(RE_CODIGO_MP, { each: true, message: 'cada código debe tener la forma 799512-11-LE26' })
  codigos!: string[];

  @ApiPropertyOptional({ description: 'Vuelve a encolar aunque ya se hayan bajado', default: false })
  @IsOptional()
  @IsBoolean()
  forzar?: boolean;
}
