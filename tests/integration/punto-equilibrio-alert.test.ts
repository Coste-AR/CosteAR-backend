import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  INDICADOR_VARIACION_PUNTO_EQUILIBRIO,
  PARAMETRO_UMBRAL_VARIACION_PUNTO_EQUILIBRIO,
} from '@/application/alerts/punto-equilibrio-alert-service.js';
import { CalculationRunService } from '@/application/cost-structures/calculation-run-service.js';
import { CLAVES_COMPORTAMIENTO_CONTRIBUCION } from '@/domain/calculations/contribucion-marginal.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { withTenantContext } from '@/infrastructure/database/tenant-context.js';
import { createTenant, disconnect, db, type Tenant } from './helpers/tenants.js';

const actor = (userId: string) => ({ id: userId, role: 'COSTISTA', area: 'costista' }) as const;

async function preparar(label: string): Promise<Tenant> {
  const tenant = await createTenant(label);
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
          departments: [{ name: 'Operación de prueba', basicRemuneration: 24, hoursWorked: 8 }],
        },
        indirectCostConfig: {
          centers: [{ id: 'centro-prueba', name: 'Centro de prueba', type: 'productive' }],
          concepts: [{ name: 'Servicio de prueba', amount: { fixed: 12, variable: 0 }, distribution: { 'centro-prueba': 1 } }],
          serviceDistributions: [],
          productiveSettings: [{ centerId: 'centro-prueba', normalCapacity: 6, actualActivity: 6, actualCip: 12 }],
        },
        salesUnitPrice: 15,
        salesQuantity: 6,
      },
    });
    await withTenant(tenant.userId, (tx) =>
      tx.parametroCosteo.createMany({
        data: [
          ...Object.entries({
            [CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima]: 'VARIABLE',
            [CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta]: 'FIJO',
            [CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos]: 'FIJO',
          }).map(([clave, comportamientoVolumen]) => ({
            companyId: tenant.companyId,
            userId: tenant.userId,
            structureId: tenant.structureId,
            clave,
            comportamientoVolumen: comportamientoVolumen as 'VARIABLE' | 'FIJO',
            clasificadoPorUserId: tenant.userId,
            clasificadoEn: new Date('2026-09-02T10:00:00.000Z'),
          })),
          {
            companyId: tenant.companyId,
            userId: tenant.userId,
            structureId: tenant.structureId,
            periodId: tenant.periodId,
            clave: PARAMETRO_UMBRAL_VARIACION_PUNTO_EQUILIBRIO,
            valorNum: 10,
            confirmado: false,
          },
        ],
      }),
    );
  });
  return tenant;
}

async function recalcularConPrecio(tenant: Tenant, price: number) {
  await withTenantContext(tenant.userId, async () => {
    await withTenant(tenant.userId, (tx) =>
      tx.costStructure.update({ where: { id: tenant.structureId }, data: { salesUnitPrice: price } }),
    );
    return new CalculationRunService(db).calculate(tenant.userId, tenant.structureId, actor(tenant.userId));
  });
}

afterAll(disconnect);

describe('A-08 — alerta por movimiento del punto de equilibrio', () => {
  let tenantAlerta: Tenant;
  let tenantSinAlerta: Tenant;

  beforeAll(async () => {
    tenantAlerta = await preparar('pe-alerta');
    tenantSinAlerta = await preparar('pe-sin-alerta');
  });

  it('crea la regla por defecto y alerta cuando el precio mueve el indicador por encima del umbral configurable', async () => {
    await withTenantContext(tenantAlerta.userId, async () => {
      await new CalculationRunService(db).calculate(tenantAlerta.userId, tenantAlerta.structureId, actor(tenantAlerta.userId));
      await recalcularConPrecio(tenantAlerta, 14);

      const regla = await db.reglaAlerta.findUniqueOrThrow({
        where: {
          companyId_structureId_indicador: {
            companyId: tenantAlerta.companyId,
            structureId: tenantAlerta.structureId,
            indicador: INDICADOR_VARIACION_PUNTO_EQUILIBRIO,
          },
        },
      });
      const alerta = await db.alert.findFirstOrThrow({
        where: { costStructureId: tenantAlerta.structureId, type: 'INDICADOR_FISICO' },
        orderBy: { createdAt: 'desc' },
      });

      expect(Number(regla.umbral)).toBe(10);
      expect(Number(alerta.threshold)).toBe(10);
      expect(Number(alerta.actualValue)).toBeGreaterThan(10);
    });
  });

  it('no alerta cuando el movimiento queda por debajo del umbral', async () => {
    await withTenantContext(tenantSinAlerta.userId, async () => {
      await new CalculationRunService(db).calculate(tenantSinAlerta.userId, tenantSinAlerta.structureId, actor(tenantSinAlerta.userId));
      await recalcularConPrecio(tenantSinAlerta, 14.5);

      const alertas = await db.alert.findMany({
        where: { costStructureId: tenantSinAlerta.structureId, type: 'INDICADOR_FISICO' },
      });
      expect(alertas).toHaveLength(0);
    });
  });
});
