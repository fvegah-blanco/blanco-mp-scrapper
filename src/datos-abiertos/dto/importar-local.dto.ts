import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

export class ImportarLocalDto {
  @ApiProperty({ enum: ['OC', 'LIC'] })
  @IsIn(['OC', 'LIC'])
  tipo!: 'OC' | 'LIC';

  @ApiProperty({ example: '2026-11.csv', description: 'Archivo .csv dentro de TMP_DIR (solo el nombre o una ruta relativa)' })
  @IsString()
  @MaxLength(300)
  @Matches(/\.csv$/i, { message: 'ruta debe apuntar a un .csv' })
  ruta!: string;
}
