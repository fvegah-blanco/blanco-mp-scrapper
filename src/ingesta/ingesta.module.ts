import { Global, Module } from '@nestjs/common';
import { ContactosRepository } from './contactos.repository';
import { IngestaRepository } from './ingesta.repository';

@Global()
@Module({
  providers: [IngestaRepository, ContactosRepository],
  exports: [IngestaRepository, ContactosRepository],
})
export class IngestaModule {}
