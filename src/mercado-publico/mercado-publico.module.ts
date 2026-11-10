import { Global, Module } from '@nestjs/common';
import { AdjuntosClient } from './adjuntos.client';
import { BuscadorClient } from './buscador.client';
import { FichaOcClient } from './ficha-oc.client';
import { OfertasClient } from './ofertas.client';

@Global()
@Module({
  providers: [BuscadorClient, FichaOcClient, AdjuntosClient, OfertasClient],
  exports: [BuscadorClient, FichaOcClient, AdjuntosClient, OfertasClient],
})
export class MercadoPublicoModule {}
