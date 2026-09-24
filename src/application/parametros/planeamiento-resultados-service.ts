import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { calcularPlaneamientoResultados } from '../../domain/calculations/planeamiento-resultados.js';
import { withTenant } from '../../infrastructure/database/prisma.js';
import type { PlaneamientoResultadosInput } from '../../shared/schemas/planeamiento-resultados.schema.js';

export class PlaneamientoResultadosService {
  async calcular(userId: string, companyId: string, input: PlaneamientoResultadosInput) {
    const company = await withTenant(userId, (tx) => tx.company.findFirst({ where: { id: companyId, userId, deletedAt: null }, select: { id: true } }));
    if (!company) throw new NotFoundError('Empresa no encontrada.');
    const { objetivo } = input;
    if (objetivo.tipo === 'porcentaje_sobre_ventas' || objetivo.tipo === 'porcentaje_sobre_costos') {
      throw new UnprocessableEntityError(
        'R12: el objetivo no puede definirse como porcentaje de ventas ni de costos. Yardín muestra que un empresario puede cumplir ese porcentaje y, al operar a la mitad, empeorar su situación.',
        { field: 'objetivo.tipo' },
      );
    }
    return calcularPlaneamientoResultados({ ...input, objetivo });
  }
}
