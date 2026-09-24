import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';
import { calcularCapacidadOciosa } from '../../domain/calculations/capacidad-ociosa.js';
import type { CalculationOutput } from '../../domain/calculations/calculate.js';

type ResultadoCorrida = {
  detail?: {
    directLabor?: { idleCapacity?: CalculationOutput['detail']['directLabor']['idleCapacity'] };
    indirectCosts?: { perDepartment?: Record<string, { budgetVariance: number; volumeVariance: number; overUnderApplied: number }> };
    unitCost?: { unitsProduced?: number };
  };
  contribucionMarginal?: { incompleta?: boolean; contribucionMarginalUnitaria?: number | null };
};

export class CapacidadOciosaService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async calcular(userId: string, companyId: string) {
    const company = await withTenant(userId, (tx) => tx.company.findFirst({
      where: { id: companyId, userId },
      select: { operationScaleValue: true, operationScaleUnit: true },
    }));
    if (!company) throw new NotFoundError('Negocio no encontrado');

    const run = await withTenant(userId, (tx) => tx.calculationRun.findFirst({
      where: { structure: { companyId, userId } },
      orderBy: [{ validated: 'desc' }, { executedAt: 'desc' }],
      select: { id: true, validated: true, executedAt: true, results: true },
    }));
    if (!run) {
      return {
        corrida: null, ociosidadR22: { valor: null, motivo: 'No hay una corrida de cálculo para el negocio.' },
        manoDeObra: null,
        cip: { variacionPresupuesto: 0, variacionVolumen: 0, controlDosVias: { sobreSubaplicacion: 0, diferencia: 0, cierra: true, formula: 'presupuesto + volumen = -(aplicado - real)' } },
        tresVias: { bloqueada: true as const, motivo: 'Requiere una base estándar para la producción real (O1-02); el motor hoy solo conoce actividad real y capacidad normal.' },
      };
    }

    const resultado = run.results as ResultadoCorrida;
    const centros = Object.values(resultado.detail?.indirectCosts?.perDepartment ?? {});
    const contribucion = resultado.contribucionMarginal;
    // R22 multiplica UNIDADES ociosas por CM/unidad. `operationScaleValue` también
    // admite escalas anuales: mezclarlas con una corrida mensual daría un número
    // falso. Solo se calcula cuando la unidad declara explícitamente el período.
    const capacidadNormal = company.operationScaleUnit === 'unidades_por_periodo' && company.operationScaleValue !== null
      ? Number(company.operationScaleValue)
      : null;
    const calculo = calcularCapacidadOciosa({
      capacidadNormal,
      actividadReal: resultado.detail?.unitCost?.unitsProduced ?? null,
      contribucionMarginalUnitaria: !contribucion || contribucion.incompleta
        ? null
        : (contribucion.contribucionMarginalUnitaria ?? null),
      centrosCip: centros,
    });
    return {
      corrida: { id: run.id, validada: run.validated, ejecutadaEn: run.executedAt.toISOString() },
      ...calculo,
      ociosidadR22: {
        ...calculo.ociosidadR22,
        capacidadNormal,
        actividadReal: resultado.detail?.unitCost?.unitsProduced ?? null,
        unidad: company.operationScaleUnit,
      },
      manoDeObra: resultado.detail?.directLabor?.idleCapacity ?? null,
    };
  }
}
