import { Decimal } from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { NotFoundError, UnprocessableEntityError, ValidationError } from '../../domain/errors/domain-error.js';
import { Percentage } from '../../domain/value-objects/percentage.js';
import { calcDepartmentMod } from '../../domain/calculations/direct-labor.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import type { ParteHorasCreateInput } from '../../shared/schemas/parte-horas.schema.js';

class ExtraCauseNotApprovedError extends UnprocessableEntityError { override readonly code = 'EXTRA_CAUSE_NOT_APPROVED'; }
class InvalidTimeSheetStateError extends ValidationError { override readonly code = 'INVALID_TIME_SHEET_STATE'; }

const utcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const present = <T extends { horasNormales: unknown; horasExtra: unknown; tarifaHora: unknown; primaExtraHora: unknown; importeMod: unknown }>(row: T) => ({
  ...row,
  horasNormales: Number(row.horasNormales), horasExtra: Number(row.horasExtra),
  tarifaHora: Number(row.tarifaHora), primaExtraHora: Number(row.primaExtraHora),
  importeMod: row.importeMod === null ? null : Number(row.importeMod),
});

export class ParteHorasService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async create(userId: string, ordenId: string, input: ParteHorasCreateInput, actor: TraceActor) {
    const orden = await withTenant(userId, (tx) => tx.ordenTrabajo.findFirst({
      where: { id: ordenId, userId }, include: { company: { select: { politicaPrimaExtra: true } } },
    }));
    if (!orden) throw new NotFoundError('Orden de trabajo no encontrada');
    const [etapa, tarifa] = await Promise.all([
      withTenant(userId, (tx) => tx.etapaOrden.findFirst({ where: { id: input.etapaId, ordenId, userId } })),
      withTenant(userId, (tx) => tx.tarifaManoObra.findFirst({ where: { id: input.tarifaId, companyId: orden.companyId, userId } })),
    ]);
    if (!etapa) throw new NotFoundError('Etapa de la orden no encontrada');
    if (!tarifa) throw new NotFoundError('Tarifa de mano de obra no encontrada');

    const directa = orden.company.politicaPrimaExtra === 'DIRECTA_CON_CAUSA';
    if (directa && input.horasExtra > 0) {
      const versionId = input.causaExtra?.versionPresupuestoId;
      const adicional = versionId ? await withTenant(userId, (tx) => tx.versionPresupuesto.findFirst({
        where: { id: versionId, ordenId, userId, tipo: 'ADICIONAL', estado: 'APROBADO' },
      })) : null;
      if (!adicional) throw new ExtraCauseNotApprovedError('La prima extra directa exige un adicional aprobado', { field: 'causaExtra.versionPresupuestoId' });
    }

    const calculada = calcDepartmentMod({
      name: tarifa.nombre,
      basicRemuneration: Number(tarifa.basicRemuneration),
      hoursWorked: Number(tarifa.hoursWorked),
      productiveHours: tarifa.productiveHours === null ? undefined : Number(tarifa.productiveHours),
      standardHours: tarifa.standardHours === null ? undefined : Number(tarifa.standardHours),
    }, Percentage.fromPercent(tarifa.itcsPct.toString()));
    const tarifaHora = calculada.hourlyRate.toNumber();
    const primaExtraHora = directa ? new Decimal(tarifaHora).times(tarifa.primaExtraPct.toString()).dividedBy(100).toNumber() : 0;

    return withTenant(userId, async (tx) => {
      const creado = await tx.parteHoras.create({ data: {
        ordenId, etapaId: input.etapaId, userId, personaId: input.personaId, fecha: utcDate(input.fecha),
        horasNormales: input.horasNormales, horasExtra: input.horasExtra, tarifaId: input.tarifaId,
        tarifaHora, primaExtraHora, causaExtra: input.causaExtra?.texto ?? null,
        versionPresupuestoId: input.causaExtra?.versionPresupuestoId ?? null,
        incluyeBaseHorasTaller: !etapa.esEntrega,
      } });
      await recordTraceAudit({ entityType: 'ParteHoras', entityId: creado.id, action: 'create', actor, after: creado }, tx);
      return present(creado);
    });
  }

  async list(userId: string, ordenId: string) {
    const orden = await withTenant(userId, (tx) => tx.ordenTrabajo.findFirst({ where: { id: ordenId, userId }, select: { id: true } }));
    if (!orden) throw new NotFoundError('Orden de trabajo no encontrada');
    const rows = await withTenant(userId, (tx) => tx.parteHoras.findMany({ where: { ordenId, userId }, orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }] }));
    return rows.map(present);
  }

  async approve(userId: string, id: string, actor: TraceActor) {
    const actual = await withTenant(userId, (tx) => tx.parteHoras.findFirst({ where: { id, userId } }));
    if (!actual) throw new NotFoundError('Parte de horas no encontrado');
    if (actual.estado !== 'CARGADO') throw new InvalidTimeSheetStateError('Sólo un parte cargado se puede aprobar');
    const importeMod = new Decimal(actual.horasNormales.toString()).plus(actual.horasExtra.toString())
      .times(actual.tarifaHora.toString())
      .plus(new Decimal(actual.horasExtra.toString()).times(actual.primaExtraHora.toString())).toNumber();
    return withTenant(userId, async (tx) => {
      const aprobado = await tx.parteHoras.update({ where: { id }, data: { estado: 'APROBADO', importeMod, aprobadoPor: actor.id, aprobadoAt: new Date() } });
      await recordTraceAudit({ entityType: 'ParteHoras', entityId: id, action: 'approve', actor, before: actual, after: aprobado }, tx);
      return present(aprobado);
    });
  }
}
