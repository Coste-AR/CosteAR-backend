import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

interface DatosFisicos {
  unidadId: string;
  loteId: string;
}

let A: Tenant;
let B: Tenant;
let datosA: DatosFisicos;
let datosB: DatosFisicos;

async function crearDatos(tenant: Tenant, sufijo: string): Promise<DatosFisicos> {
  return withTenant(tenant.userId, async (tx) => {
    const unidad = await tx.unidadProductiva.create({
      data: {
        companyId: tenant.companyId,
        userId: tenant.userId,
        referencia: `unidad_${sufijo}`,
      },
    });
    const lote = await tx.loteProductivo.create({
      data: {
        companyId: tenant.companyId,
        userId: tenant.userId,
        unidadProductivaId: unidad.id,
        referencia: `lote_${sufijo}`,
      },
    });
    return { unidadId: unidad.id, loteId: lote.id };
  });
}

beforeAll(async () => {
  A = await createTenant('unidad-a');
  B = await createTenant('unidad-b');
  datosA = await crearDatos(A, 'a');
  datosB = await crearDatos(B, 'b');
});

afterAll(disconnect);

describe('A-09 — operación física genérica aislada por empresa', () => {
  it('una empresa no puede leer las unidades ni los lotes de otra', async () => {
    const unidadesAj = await withTenant(A.userId, (tx) =>
      tx.unidadProductiva.findMany({ where: { companyId: B.companyId } }),
    );
    const lotesAj = await withTenant(A.userId, (tx) =>
      tx.loteProductivo.findMany({ where: { companyId: B.companyId } }),
    );

    expect(unidadesAj).toEqual([]);
    expect(lotesAj).toEqual([]);

    const propias = await withTenant(A.userId, (tx) =>
      tx.unidadProductiva.findMany({ where: { companyId: A.companyId } }),
    );
    expect(propias.map((unidad) => unidad.id)).toContain(datosA.unidadId);
    expect(propias.map((unidad) => unidad.id)).not.toContain(datosB.unidadId);
  });

  it('un lote puede cambiar su ubicación actual dentro de su empresa', async () => {
    const otraUnidad = await withTenant(A.userId, (tx) =>
      tx.unidadProductiva.create({
        data: {
          companyId: A.companyId,
          userId: A.userId,
          referencia: 'unidad_a_2',
        },
      }),
    );

    const lote = await withTenant(A.userId, (tx) =>
      tx.loteProductivo.update({
        where: { id: datosA.loteId },
        data: { unidadProductivaId: otraUnidad.id },
      }),
    );

    expect(lote.unidadProductivaId).toBe(otraUnidad.id);
  });

  it('la ubicación actual no puede apuntar a una unidad de otra empresa', async () => {
    await expect(
      withTenant(A.userId, (tx) =>
        tx.loteProductivo.create({
          data: {
            companyId: A.companyId,
            userId: A.userId,
            unidadProductivaId: datosB.unidadId,
            referencia: 'lote_a_invalido',
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
