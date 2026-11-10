import { Global, Module } from '@nestjs/common';
import { AdjuntosClient } from './adjuntos.client';
import { BuscadorClient } from './buscador.client';
import { FichaOcClient } from './ficha-oc.client';

@Global()
@Module({
  providers: [BuscadorClient, FichaOcClient, AdjuntosClient],
  exports: [BuscadorClient, FichaOcClient, AdjuntosClient],
})
export class MercadoPublicoModule {}
