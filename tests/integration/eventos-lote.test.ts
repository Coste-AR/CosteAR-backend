import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventosLoteService } from '@/application/operacion/eventos-lote-service.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let A: Tenant;
let B: Tenant;
let loteA: string;
let loteB: string;

async function crearLote(tenant: Tenant, referencia: string) {
  return withTenant(tenant.userId, async (tx) =>
    tx.loteProductivo.create({
      data: { companyId: tenant.companyId, userId: tenant.userId, referencia },
    }),
  );
}

beforeAll(async () => {
  A = await createTenant('evento-lote-a');
  B = await createTenant('evento-lote-b');
  loteA = (await crearLote(A, 'lote_evento_a')).id;
  loteB = (await crearLote(B, 'lote_evento_b')).id;
});

afterAll(disconnect);

describe('A-10 — eventos de lote aislados y población derivada', () => {
  it('deriva animales vivos de altas y bajas clasificadas, sin un campo editable', async () => {
    const service = new EventosLoteService();
    const actor = { id: A.userId, role: 'COSTISTA', area: 'costista', method: 'manual' };
    await service.create(A.userId, loteA, { tipo: 'alta', cantidad: 40, fecha: '2026-09-01' }, actor);
    await service.create(A.userId, loteA, { tipo: 'baja', cantidad: 5, fecha: '2026-09-02', motivo: 'mortalidad' }, actor);

    // Simula un dato histórico incompleto: la vía manual lo rechaza, pero se
    // conserva para que quede pendiente de clasificación en vez de inventarla.
    await withTenant(A.userId, (tx) =>
      tx.eventoLote.create({
        data: {
          companyId: A.companyId,
          userId: A.userId,
          loteId: loteA,
          tipo: 'BAJA',
          cantidad: 4,
          fecha: new Date('2026-09-03T00:00:00.000Z'),
          motivo: null,
        },
      }),
    );

    const saldo = await service.poblacion(A.userId, loteA);
    expect(saldo.cantidadViva).toBe(35);
    expect(saldo.pendientes).toHaveLength(1);

    // La columna no existe: ni Prisma acepta una escritura manual de saldo.
    await expect(
      withTenant(A.userId, (tx) =>
        tx.eventoLote.create({
          data: {
            companyId: A.companyId,
            userId: A.userId,
            loteId: loteA,
            tipo: 'ALTA',
            cantidad: 1,
            fecha: new Date('2026-09-04T00:00:00.000Z'),
            // @ts-expect-error `cantidadViva` no es persistible en EventoLote.
            cantidadViva: 999,
          },
        }),
      ),
    ).rejects.toThrow(/cantidadViva/);
  });

  it('RLS no permite leer eventos del lote de otra empresa', async () => {
    const ajenos = await withTenant(B.userId, (tx) =>
      tx.eventoLote.findMany({ where: { companyId: A.companyId, loteId: loteA } }),
    );
    expect(ajenos).toEqual([]);

    const propios = await withTenant(B.userId, (tx) =>
      tx.eventoLote.findMany({ where: { companyId: B.companyId, loteId: loteB } }),
    );
    expect(propios).toEqual([]);
  });
});
