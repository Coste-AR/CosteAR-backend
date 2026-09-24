import type { Prisma } from '@prisma/client';
import { calcularMezclaOptima } from '../../domain/calculations/mezcla-optima.js';
import { contribucionMarginalSegmento, type CoproductoSectorial } from '../../domain/calculations/equilibrio-sectorial.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { withTenant } from '../../infrastructure/database/prisma.js';

type Recurso = {
  id: string; clave: string; disponibleEnPeriodo: Prisma.Decimal; esCuelloDeBotellaActivo: boolean;
  unidad: { codigo: string; nombre: string };
  consumos: Array<{
    consumoPorUnidad: Prisma.Decimal; demandaMaxima: Prisma.Decimal;
    segmento: { id: string; nombre: string; precioUnitario: Prisma.Decimal | null; costoVariableUnitario: Prisma.Decimal | null; produccionConjunta: boolean; coproductos: Prisma.JsonValue };
  }>;
};

const SIN_CUELLO = 'No hay un cuello de botella activo; marcá el recurso que limita la producción para calcular el ranking.';

export class MezclaOptimaService {
  async calcular(userId: string, companyId: string) {
    const company = await withTenant(userId, (tx) => tx.company.findFirst({ where: { id: companyId, userId, deletedAt: null }, select: { id: true } }));
    if (!company) throw new NotFoundError('Empresa no encontrada.');

    const recursos = await withTenant(userId, (tx) => tx.recursoEscaso.findMany({
      where: { companyId, deletedAt: null },
      include: {
        unidad: { select: { codigo: true, nombre: true } },
        consumos: {
          where: { deletedAt: null, segmento: { deletedAt: null } },
          include: { segmento: { select: { id: true, nombre: true, precioUnitario: true, costoVariableUnitario: true, produccionConjunta: true, coproductos: true } } },
        },
      },
    })) as Recurso[];

    const activos = recursos.filter((recurso) => recurso.esCuelloDeBotellaActivo);
    if (activos.length === 0) return { recurso: null, ranking: [], contribucionMarginalTotal: null, recursoRestante: null, motivoSinRanking: SIN_CUELLO };
    if (activos.length > 1) {
      throw new UnprocessableEntityError('Hay más de un recurso escaso activo: desactivá el que no limita esta decisión o usá programación lineal para restricciones múltiples.', { field: 'esCuelloDeBotellaActivo' });
    }

    const recurso = activos[0]!;
    const calculo = calcularMezclaOptima({
      disponible: Number(recurso.disponibleEnPeriodo),
      unidadRecurso: recurso.unidad.codigo,
      productos: recurso.consumos.map(({ segmento, consumoPorUnidad, demandaMaxima }) => ({
        id: segmento.id,
        producto: segmento.nombre,
        cm: contribucionMarginalSegmento({
          id: segmento.id, nombre: segmento.nombre, participacion: 0,
          precioUnitario: segmento.precioUnitario === null ? null : Number(segmento.precioUnitario),
          costoVariableUnitario: segmento.costoVariableUnitario === null ? null : Number(segmento.costoVariableUnitario),
          costoFijoDirecto: 0, prorrateoIndirectos: 0, produccionConjunta: segmento.produccionConjunta,
          coproductos: segmento.coproductos as unknown as CoproductoSectorial[],
        }),
        consumoPorUnidad: Number(consumoPorUnidad), demandaMaxima: Number(demandaMaxima),
      })),
    });
    return {
      recurso: { id: recurso.id, clave: recurso.clave, disponibleEnPeriodo: Number(recurso.disponibleEnPeriodo), unidad: recurso.unidad.codigo, nombreUnidad: recurso.unidad.nombre },
      ...calculo,
      motivoSinRanking: calculo.ranking.length === 0 ? 'No hay productos con contribución, consumo y demanda válidos para ordenar.' : null,
    };
  }
}
