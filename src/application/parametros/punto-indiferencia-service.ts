import { puntoIndiferencia } from '../../domain/calculations/punto-indiferencia.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';
import { withTenant } from '../../infrastructure/database/prisma.js';
import type { PuntoIndiferenciaInput } from '../../shared/schemas/punto-indiferencia.schema.js';

export class PuntoIndiferenciaService {
  async calcular(userId: string, companyId: string, input: PuntoIndiferenciaInput) {
    const company = await withTenant(userId, (tx) => tx.company.findFirst({
      where: { id: companyId, userId, deletedAt: null },
      select: { id: true },
    }));
    if (!company) throw new NotFoundError('Empresa no encontrada.');
    return puntoIndiferencia(input);
  }
}
