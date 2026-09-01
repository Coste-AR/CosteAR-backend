import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProcessCostingEngine, type ProcessCalculationInput } from '@/application/cost-structures/process-costing/process-costing-engine.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { db, createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let tenant: Tenant;

beforeAll(async () => {
  tenant = await createTenant('comportamiento');
});

afterAll(disconnect);

const inputDeEnsayo: ProcessCalculationInput = {
  departments: [
    {
      id: 'departamento-ensayo',
      name: 'Departamento de ensayo',
      sequence: 1,
      periodId: 'periodo-ensayo',
      units: {
        initialWip: 0,
        startedInProduction: 100,
        transferredOut: 100,
        finishedInStock: 0,
        normalLossPct: 0,
        totalLossReported: 0,
      },
      finalWipConversionAvance: 0,
      costs: {
        mpInicial: 0,
        mpPeriodo: 200,
        moInicial: 0,
        moPeriodo: 300,
      },
    },
  ],
};

describe('A-03 — comportamiento frente al volumen', () => {
  it('guarda los tres valores permitidos junto a quién clasificó y cuándo', async () => {
    const clasificaciones = [];
    for (const comportamientoVolumen of ['VARIABLE', 'FIJO', 'SEMIFIJO'] as const) {
      clasificaciones.push(
        await withTenant(tenant.userId, (tx) =>
          tx.parametroCosteo.create({
            data: {
              companyId: tenant.companyId,
              userId: tenant.userId,
              structureId: tenant.structureId,
              periodId: tenant.periodId,
              clave: `concepto_ensayo_${comportamientoVolumen.toLowerCase()}`,
              comportamientoVolumen,
              clasificadoPorUserId: tenant.userId,
              clasificadoEn: new Date('2026-09-01T12:00:00.000Z'),
            },
          }),
        ),
      );
    }

    expect(clasificaciones.map((fila) => fila.comportamientoVolumen).sort()).toEqual([
      'FIJO',
      'SEMIFIJO',
      'VARIABLE',
    ]);
    for (const fila of clasificaciones) {
      expect(fila.clasificadoPorUserId).toBe(tenant.userId);
      expect(fila.clasificadoEn).toEqual(new Date('2026-09-01T12:00:00.000Z'));
    }
  });

  it('rechaza un valor fuera de VARIABLE, FIJO y SEMIFIJO', async () => {
    await expect(
      db.$queryRawUnsafe(`SELECT 'NO_DEFINIDO'::"ComportamientoCosto"`),
    ).rejects.toThrow();
  });

  it('agregar la clasificación no modifica un importe ya calculado por absorción', async () => {
    const engine = new ProcessCostingEngine();
    const antes = engine.run(inputDeEnsayo).results.finalUnitCost;

    await withTenant(tenant.userId, (tx) =>
      tx.parametroCosteo.create({
        data: {
          companyId: tenant.companyId,
          userId: tenant.userId,
          structureId: tenant.structureId,
          periodId: tenant.periodId,
          clave: 'concepto_ensayo_sin_impacto',
          comportamientoVolumen: 'VARIABLE',
          clasificadoPorUserId: tenant.userId,
          clasificadoEn: new Date('2026-09-01T12:05:00.000Z'),
        },
      }),
    );

    const despues = engine.run(inputDeEnsayo).results.finalUnitCost;
    expect(despues).toBe(antes);
  });
});
