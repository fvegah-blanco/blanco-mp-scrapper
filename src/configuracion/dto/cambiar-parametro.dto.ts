import { ApiProperty } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';

export class CambiarParametroDto {
  @ApiProperty({ oneOf: [{ type: 'number' }, { type: 'boolean' }], example: 20 })
  @IsDefined()
  valor!: number | boolean;
}
