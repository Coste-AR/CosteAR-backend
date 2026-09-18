import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CalculationRunService } from '@/application/cost-structures/calculation-run-service.js';
import { CostStructureService } from '@/application/cost-structures/cost-structure-service.js';
import {
  CLAVES_COMPORTAMIENTO_CONTRIBUCION,
  type ContribucionMarginal,
} from '@/domain/calculations/contribucion-marginal.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { withTenantContext } from '@/infrastructure/database/tenant-context.js';
import { createTenant, disconnect, db, type Tenant } from './helpers/tenants.js';

let tenant: Tenant;

beforeAll(async () => {
  tenant = await createTenant('contribucion-marginal');
  await withTenantContext(tenant.userId, async () => {
    await db.costStructure.update({
      where: { id: tenant.structureId },
      data: {
        rawMaterialConfig: {
          wilson: { annualDemand: 100, orderCost: 10, holdingRate: 0.3, unitCost: 4 },
          stockPolicy: { minConsumption: 1, maxConsumption: 2, minLeadTime: 1, maxLeadTime: 2, safetyStock: 1 },
          initialStock: { quantity: 10, unitCost: 4 },
          movements: [{ date: '2026-08-10', type: 'consumption', detail: 'Uso de prueba', quantity: 9 }],
        },
        directLaborConfig: {
          workingDays: {
            totalDaysPerYear: 365,
            unpaidAbsence: { sundays: 0, saturdays: 0, unjustifiedAbsences: 0, holidaysOnWeekend: 0 },
            paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 },
          },
          itcs: { derivationBase: 0, fixedArt: 0, uncertainRemunerative: [], uncertainNonRemunerative: [] },
          departments: [{ name: 'Operación', basicRemuneration: 24, hoursWorked: 8 }],
        },
        indirectCostConfig: {
          centers: [{ id: 'centro-1', name: 'Centro 1', type: 'productive' }],
          concepts: [{ name: 'Servicio', amount: { fixed: 12, variable: 0 }, distribution: { 'centro-1': 1 } }],
          serviceDistributions: [],
          productiveSettings: [{ centerId: 'centro-1', normalCapacity: 6, actualActivity: 6, actualCip: 12 }],
        },
        salesUnitPrice: 15,
        salesQuantity: 6,
      },
    });
    await withTenant(tenant.userId, (tx) =>
      tx.parametroCosteo.createMany({
        data: [
          {
            companyId: tenant.companyId,
            userId: tenant.userId,
            structureId: tenant.structureId,
            clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima,
            comportamientoVolumen: 'VARIABLE',
            clasificadoPorUserId: tenant.userId,
            clasificadoEn: new Date('2026-09-02T10:00:00.000Z'),
          },
          {
            companyId: tenant.companyId,
            userId: tenant.userId,
            structureId: tenant.structureId,
            clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta,
            comportamientoVolumen: 'FIJO',
            clasificadoPorUserId: tenant.userId,
            clasificadoEn: new Date('2026-09-02T10:00:00.000Z'),
          },
          {
            companyId: tenant.companyId,
            userId: tenant.userId,
            structureId: tenant.structureId,
            clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos,
            comportamientoVolumen: 'FIJO',
            clasificadoPorUserId: tenant.userId,
            clasificadoEn: new Date('2026-09-02T10:00:00.000Z'),
          },
        ],
      }),
    );
  });
});

afterAll(disconnect);

describe('A-05 — contribución marginal persistida por período', () => {
  it('cargar trabajos de terceros mueve el costo real y el margen del tablero', async () => {
    const structures = new CostStructureService(db);
    const runs = new CalculationRunService(db);
    const actor = { id: tenant.userId, role: 'COSTISTA', area: 'costista' } as const;

    const sinTerceros = await withTenantContext(tenant.userId, () =>
      runs.calculate(tenant.userId, tenant.structureId, actor, 'MANUAL', tenant.periodId),
    );

    await withTenantContext(tenant.userId, () =>
      structures.updateThirdPartyWork(tenant.userId, tenant.structureId, 25, {
        userId: tenant.userId,
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      }),
    );

    // Distingue el origen: una corrida asociada a un período debe leer su foto,
    // aunque el espejo vigente de la estructura ya tenga otro importe.
    await withTenant(tenant.userId, (tx) =>
      tx.costStructure.update({ where: { id: tenant.structureId }, data: { thirdPartyWork: 999 } }),
    );

    try {
      const conTerceros = await withTenantContext(tenant.userId, () =>
        runs.calculate(tenant.userId, tenant.structureId, actor, 'MANUAL', tenant.periodId),
      );

      expect(conTerceros.results.thirdPartyWork).toBe(25);
      expect(conTerceros.results.realProductionCost! - sinTerceros.results.realProductionCost!)
        .toBeCloseTo(25, 6);
      expect(sinTerceros.results.grossMargin - conTerceros.results.grossMargin)
        .toBeCloseTo(25, 6);
    } finally {
      // Este archivo comparte tenant entre casos. La restauración pasa por la
      // mutación productiva (con versión y auditoría), no por un UPDATE de test
      // que podría ocultar un problema en ese camino.
      await withTenantContext(tenant.userId, () =>
        structures.updateThirdPartyWork(tenant.userId, tenant.structureId, 0, {
          userId: tenant.userId,
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        }),
      );
    }
  });

  it('persiste la vista y cambia sólo al cambiar una clasificación', async () => {
    const service = new CalculationRunService(db);
    const actor = { id: tenant.userId, role: 'COSTISTA', area: 'costista' } as const;

    const primera = await withTenantContext(tenant.userId, () =>
      service.calculate(tenant.userId, tenant.structureId, actor),
    );
    const contribucionAntes = (primera.results as { contribucionMarginal: ContribucionMarginal }).contribucionMarginal;
    expect(contribucionAntes).toMatchObject({ incompleta: false, contribucionMarginalUnitaria: 9 });

    const corridaPersistida = await withTenant(tenant.userId, (tx) =>
      tx.calculationRun.findUniqueOrThrow({ where: { id: primera.run.id } }),
    );
    expect(corridaPersistida.periodId).toBe(tenant.periodId);
    expect((corridaPersistida.results as { contribucionMarginal: ContribucionMarginal }).contribucionMarginal)
      .toEqual(contribucionAntes);

    await withTenant(tenant.userId, (tx) =>
      tx.parametroCosteo.updateMany({
        where: {
          companyId: tenant.companyId,
          structureId: tenant.structureId,
          clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos,
        },
        data: {
          comportamientoVolumen: 'VARIABLE',
          clasificadoPorUserId: tenant.userId,
          clasificadoEn: new Date('2026-09-02T10:05:00.000Z'),
        },
      }),
    );

    const segunda = await withTenantContext(tenant.userId, () =>
      service.calculate(tenant.userId, tenant.structureId, actor),
    );
    const contribucionDespues = (segunda.results as { contribucionMarginal: ContribucionMarginal }).contribucionMarginal;
    expect(contribucionDespues).toMatchObject({ incompleta: false, contribucionMarginalUnitaria: 7 });
    expect(segunda.results.productionCost).toBe(primera.results.productionCost);
  });

  it('el simulador comparte la vista persistida, refleja shocks y marca faltantes', async () => {
    const simulator = new CostStructureService(db);
    const runs = new CalculationRunService(db);
    const actor = { id: tenant.userId, role: 'COSTISTA', area: 'costista' } as const;

    const simulated = await withTenantContext(tenant.userId, () =>
      simulator.simulate(tenant.userId, tenant.structureId, {}),
    );
    const persisted = await withTenantContext(tenant.userId, () =>
      runs.calculate(tenant.userId, tenant.structureId, actor),
    );

    expect(simulated.result).toMatchObject({
      rawMaterialConsumed: persisted.results.rawMaterialConsumed,
      directLaborTotal: persisted.results.directLaborTotal,
      indirectCostsApplied: persisted.results.indirectCostsApplied,
      incompletitud: persisted.results.incompletitud,
      contribucionMarginal: persisted.results.contribucionMarginal,
    });
    expect(simulated.result.puntoEquilibrio.unidadesEquilibrio)
      .toBe(persisted.results.puntoEquilibrio.unidadesEquilibrio);

    const shocked = await withTenantContext(tenant.userId, () =>
      simulator.simulate(tenant.userId, tenant.structureId, { sales: 0.5 }),
    );
    expect(shocked.result.puntoEquilibrio.unidadesEquilibrio)
      .not.toBe(simulated.result.puntoEquilibrio.unidadesEquilibrio);

    await withTenant(tenant.userId, (tx) =>
      tx.parametroCosteo.updateMany({
        where: { companyId: tenant.companyId, structureId: tenant.structureId },
        data: { comportamientoVolumen: null, clasificadoPorUserId: null, clasificadoEn: null, confirmado: false },
      }),
    );
    const incompleta = await withTenantContext(tenant.userId, () =>
      simulator.simulate(tenant.userId, tenant.structureId, {}),
    );
    expect(incompleta.result.contribucionMarginal.incompleta).toBe(true);
    expect(incompleta.result.puntoEquilibrio.incompleta).toBe(true);
    expect(incompleta.result.contribucionMarginal.motivos.length).toBeGreaterThan(0);
  });
});
