import type { Prisma } from '@prisma/client';
import { contribucionMarginalSegmento, type CoproductoSectorial } from '../../domain/calculations/equilibrio-sectorial.js';
import { calcularRelacionReemplazo } from '../../domain/calculations/relacion-reemplazo.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';
import { withTenant } from '../../infrastructure/database/prisma.js';
import type { RelacionReemplazoInput } from '../../shared/schemas/relacion-reemplazo.schema.js';

type Segmento = {
  id: string;
  nombre: string;
  precioUnitario: Prisma.Decimal | null;
  costoVariableUnitario: Prisma.Decimal | null;
  costoFijoDirecto: Prisma.Decimal;
  prorrateoIndirectos: Prisma.Decimal;
  produccionConjunta: boolean;
  coproductos: Prisma.JsonValue;
};

export class RelacionReemplazoService {
  async calcular(userId: string, companyId: string, input: RelacionReemplazoInput) {
    const company = await withTenant(userId, (tx) => tx.company.findFirst({
      where: { id: companyId, userId, deletedAt: null },
      select: { id: true },
    }));
    if (!company) throw new NotFoundError('Empresa no encontrada.');

    const segmentos = await withTenant(userId, (tx) => tx.segmentoAnalisis.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true, nombre: true, precioUnitario: true, costoVariableUnitario: true,
        costoFijoDirecto: true, prorrateoIndirectos: true, produccionConjunta: true, coproductos: true,
      },
    })) as Segmento[];
    const origen = segmentos.find((segmento) => segmento.id === input.segmentoOrigenId);
    const destino = segmentos.find((segmento) => segmento.id === input.segmentoDestinoId);
    if (!origen || !destino) throw new NotFoundError('Segmento de origen o destino no encontrado.');

    const contribucion = (segmento: Segmento) => contribucionMarginalSegmento({
      id: segmento.id,
      nombre: segmento.nombre,
      participacion: 0,
      precioUnitario: segmento.precioUnitario === null ? null : Number(segmento.precioUnitario),
      costoVariableUnitario: segmento.costoVariableUnitario === null ? null : Number(segmento.costoVariableUnitario),
      costoFijoDirecto: Number(segmento.costoFijoDirecto),
      prorrateoIndirectos: Number(segmento.prorrateoIndirectos),
      produccionConjunta: segmento.produccionConjunta,
      coproductos: segmento.coproductos as unknown as CoproductoSectorial[],
    });
    const costosFijosIndirectos = segmentos.reduce(
      (total, segmento) => total + Number(segmento.prorrateoIndirectos),
      0,
    );

    return calcularRelacionReemplazo({
      contribucionMarginalOrigen: contribucion(origen),
      contribucionMarginalDestino: contribucion(destino),
      cantidadOrigen: input.cantidadOrigen,
      costoFijoDirectoOrigen: Number(origen.costoFijoDirecto),
      costoFijoDirectoDestino: Number(destino.costoFijoDirecto),
      costosFijosIndirectos,
      resultadoObjetivo: input.resultadoObjetivo,
      unidadCantidad: input.unidadCantidad,
    });
  }
}
