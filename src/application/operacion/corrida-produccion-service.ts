import type { PrismaClient, DestinoCorrida } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import type { CorridaCreateInput, ConsumoCreateInput } from '../../shared/schemas/corrida-produccion.schema.js';
const destino: Record<CorridaCreateInput['destino'], DestinoCorrida> = { propia: 'PROPIA', terceros: 'TERCEROS' };
export class CorridaProduccionService {
  constructor(private readonly db: PrismaClient = prisma) {}
  async create(userId: string, companyId: string, input: CorridaCreateInput, actor: TraceActor) {
    const company = await withTenant(userId, (tx) => tx.company.findFirst({ where: { id: companyId, userId } }));
    if (!company) throw new NotFoundError('Empresa no encontrada');
    return withTenant(userId, async (tx) => {
      const corrida = await tx.corridaProduccion.create({ data: { companyId, userId, ...input, destino: destino[input.destino] } });
      await recordTraceAudit({ entityType: 'CorridaProduccion', entityId: corrida.id, action: 'create', actor, after: corrida, comment: 'Corrida de producción registrada' }, tx);
      return corrida;
    });
  }
  async consumo(userId: string, corridaId: string, input: ConsumoCreateInput, actor: TraceActor) {
    const corrida = await withTenant(userId, (tx) => tx.corridaProduccion.findFirst({ where: { id: corridaId, userId } }));
    if (!corrida) throw new NotFoundError('Corrida no encontrada');
    return withTenant(userId, async (tx) => {
      const consumo = await tx.consumoCorrida.create({ data: { companyId: corrida.companyId, userId, corridaId, ...input } });
      await recordTraceAudit({ entityType: 'ConsumoCorrida', entityId: consumo.id, action: 'create', actor, after: consumo, comment: `Consumo de corrida: ${input.material}` }, tx);
      return consumo;
    });
  }
  async resultado(userId: string, corridaId: string) {
    const corrida = await withTenant(userId, (tx) => tx.corridaProduccion.findFirst({ where: { id: corridaId, userId } }));
    if (!corrida) throw new NotFoundError('Corrida no encontrada');
    const consumos = await withTenant(userId, (tx) => tx.consumoCorrida.findMany({ where: { corridaId } }));
    if (consumos.length === 0) return { costoPorKilo: null, incompleta: true };
    const costo = consumos.reduce((sum, c) => sum + Number(c.cantidad) * Number(c.costoUnitarioPpp), 0);
    if (Number(corrida.kilosReales) <= 0) throw new UnprocessableEntityError('La corrida no tiene kilos reales válidos');
    return { costoPorKilo: costo / Number(corrida.kilosReales), incompleta: false };
  }
}
