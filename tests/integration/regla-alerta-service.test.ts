import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReglaAlertaService } from '@/application/alerts/regla-alerta-service.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let A: Tenant;
let B: Tenant;
const sendIndicatorAlert = vi.fn(async () => undefined);
const actor = (userId: string) => ({
  id: userId,
  role: 'EMPRESA_ADMIN',
  area: 'costista',
  method: 'manual',
});

beforeAll(async () => {
  A = await createTenant('regla-alerta-a');
  B = await createTenant('regla-alerta-b');
});

afterAll(disconnect);

describe('S-05b — reglas configurables con RLS real', () => {
  it('crea, audita y mantiene la regla aislada entre empresas', async () => {
    const service = new ReglaAlertaService({ sendIndicatorAlert });
    const creada = await service.crear(
      A.userId,
      A.companyId,
      {
        structureId: A.structureId,
        indicador: 'humedad_grano_ingreso',
        descripcion: 'Humedad del grano al ingreso',
        condicion: 'MAYOR',
        umbral: 16,
        lecturasSostenidas: 1,
        severidad: 'CRITICA',
        destinatarios: [],
        canal: 'IN_APP',
        activa: true,
      },
      actor(A.userId),
    );

    expect(creada.indicador).toBe('humedad_grano_ingreso');
    expect(await service.listar(A.userId, A.companyId, A.structureId)).toHaveLength(1);
    await expect(service.listar(B.userId, A.companyId)).rejects.toThrow(/negocio no encontrado/i);
    expect(
      await withTenant(B.userId, (tx) =>
        tx.reglaAlerta.findMany({ where: { companyId: A.companyId } }),
      ),
    ).toEqual([]);

    const auditoria = await withTenant(A.userId, (tx) =>
      tx.traceAuditLog.findFirst({
        where: { entityType: 'ReglaAlerta', entityId: creada.id, action: 'create' },
      }),
    );
    expect(auditoria).not.toBeNull();
  });

  it('deja consultable el dato faltante y crea alerta cuando la lectura supera el umbral', async () => {
    const service = new ReglaAlertaService({ sendIndicatorAlert });
    const [regla] = await service.listar(A.userId, A.companyId, A.structureId);
    expect(regla).toBeDefined();

    const sinDato = await service.evaluar(
      A.userId,
      A.companyId,
      regla!.id,
      { lecturas: [] },
      actor(A.userId),
    );
    expect(sinDato).toMatchObject({
      estado: 'NO_EVALUABLE',
      alerta: {
        companyId: A.companyId,
        indicador: 'humedad_grano_ingreso',
        motivoNoEvaluada: expect.stringMatching(/falta una lectura/i),
      },
    });

    const alerta = await service.evaluar(
      A.userId,
      A.companyId,
      regla!.id,
      { lecturas: [{ fecha: '2026-09-19T12:00:00.000Z', valor: 18 }] },
      actor(A.userId),
    );
    expect(alerta).toMatchObject({
      estado: 'ALERTA',
      alerta: { type: 'INDICADOR_FISICO', companyId: A.companyId },
      entrega: { canal: 'IN_APP' },
    });
    expect(sendIndicatorAlert).not.toHaveBeenCalled();
  });
});
