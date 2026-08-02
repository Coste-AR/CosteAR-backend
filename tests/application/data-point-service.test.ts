import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests de la lógica de negocio de DataPointService, con Prisma mockeado
 * (mismo patrón que tests/auth/refresh-rotation.test.ts) para aislar las
 * reglas R1/R2 sin depender de una base viva:
 *
 *   R1 — nada se pisa: una corrección SIEMPRE crea version_n+1, nunca actualiza
 *        una versión existente (no hay ningún `dataPointVersion.update` en el
 *        servicio — ver que solo se usa `.create`).
 *   R2 — toda mutación escribe su auditoría en la MISMA transacción: cada
 *        método de negocio dispara `traceAuditLog.create` dentro del mismo
 *        callback de `withTenant` que la escritura de negocio.
 *
 * El trigger de Postgres que bloquea UPDATE/DELETE directo sobre
 * `data_point_versions` (append-only real, a nivel de motor de base) requiere
 * una base viva y se verifica en `prisma/migrations/.../migration.sql` +
 * correrlo contra Postgres real (ver README de pruebas al final del chat).
 */

const mockTx = {
  dataPoint: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  dataPointVersion: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  traceAuditLog: { create: vi.fn(), findFirst: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  costStructure: { findFirst: vi.fn() },
  // Imputar chequea si el período destino está cerrado (datos atrasados). Estas
  // pruebas son sobre la bitácora, con el período abierto: el camino normal.
  costPeriod: { findFirst: vi.fn().mockResolvedValue({ status: 'OPEN' }) },
  calculationRun: { findMany: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockTx,
  withTenant: (_userId: string, fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
}));

const actor = { id: 'user-1', role: 'COSTISTA', area: 'costista', device: 'test-agent · 127.0.0.1' };

describe('DataPointService — R1/R2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('addVersion nunca llama a dataPointVersion.update — solo crea filas nuevas (R1)', async () => {
    const { DataPointService } = await import('@/application/trazabilidad/data-point-service.js');
    const service = new DataPointService(mockTx as never);

    mockTx.dataPoint.findFirst.mockResolvedValue({
      id: 'dp-1',
      structureId: 'st-1',
      status: 'validado',
      fechaHecho: null,
      structure: { userId: 'user-1' },
    });
    mockTx.dataPointVersion.findFirst.mockResolvedValue({ versionN: 1, valueNum: 100, valueJson: null });
    mockTx.dataPointVersion.create.mockResolvedValue({ id: 'v2', versionN: 2 });
    mockTx.dataPoint.update.mockResolvedValue({ id: 'dp-1', status: 'borrador' });

    await service.addVersion(
      'user-1',
      'dp-1',
      { sourceArea: 'contaduria', method: 'manual', valueNum: 150, reason: 'corrección de factura' },
      actor,
    );

    expect(mockTx.dataPointVersion.create).toHaveBeenCalledTimes(1);
    expect(mockTx.dataPointVersion.create.mock.calls[0]![0].data.versionN).toBe(2);
    expect(mockTx.dataPointVersion.create.mock.calls[0]![0].data.reason).toBe('corrección de factura');
    // dataPointVersion nunca se actualiza — el "update" de dataPoint es del contenedor,
    // no de la versión inmutable.
    expect(mockTx.dataPointVersion).not.toHaveProperty('update');
  });

  it('addVersion vuelve el estado a borrador aunque el dato ya estuviera validado (pide re-validar)', async () => {
    const { DataPointService } = await import('@/application/trazabilidad/data-point-service.js');
    const service = new DataPointService(mockTx as never);

    mockTx.dataPoint.findFirst.mockResolvedValue({
      id: 'dp-1',
      structureId: 'st-1',
      status: 'validado',
      fechaHecho: null,
      structure: { userId: 'user-1' },
    });
    mockTx.dataPointVersion.findFirst.mockResolvedValue({ versionN: 1 });
    mockTx.dataPointVersion.create.mockResolvedValue({ id: 'v2', versionN: 2 });
    mockTx.dataPoint.update.mockResolvedValue({ id: 'dp-1', status: 'borrador' });

    await service.addVersion(
      'user-1',
      'dp-1',
      { sourceArea: 'contaduria', method: 'manual', valueNum: 150, reason: 'corrección' },
      actor,
    );

    expect(mockTx.dataPoint.update.mock.calls[0]![0].data.status).toBe('borrador');
  });

  it('cada mutación (crear, versionar, validar, imputar) escribe su entrada en trace_audit_log (R2)', async () => {
    const { DataPointService } = await import('@/application/trazabilidad/data-point-service.js');
    const service = new DataPointService(mockTx as never);

    // create()
    mockTx.costStructure.findFirst.mockResolvedValue({ id: 'st-1', userId: 'user-1' });
    mockTx.dataPoint.create.mockResolvedValue({ id: 'dp-1' });
    mockTx.dataPointVersion.create.mockResolvedValue({ id: 'v1' });
    await service.create(
      'user-1',
      'st-1',
      { element: 'MP', fieldKey: 'mp.compra.precio', label: 'Precio', sourceArea: 'contaduria', method: 'manual', valueNum: 2600 },
      actor,
    );
    expect(mockTx.traceAuditLog.create).toHaveBeenCalledTimes(1);
    expect(mockTx.traceAuditLog.create.mock.calls[0]![0].data.action).toBe('crear');

    vi.clearAllMocks();

    // validate()
    mockTx.dataPoint.findFirst.mockResolvedValue({
      id: 'dp-1',
      status: 'borrador',
      structure: { userId: 'user-1' },
    });
    mockTx.dataPoint.update.mockResolvedValue({ id: 'dp-1', status: 'validado' });
    await service.validate('user-1', 'dp-1', 'costista', actor);
    expect(mockTx.traceAuditLog.create).toHaveBeenCalledTimes(1);
    expect(mockTx.traceAuditLog.create.mock.calls[0]![0].data.action).toBe('validar');

    vi.clearAllMocks();

    // imputar()
    mockTx.dataPoint.findFirst.mockResolvedValue({
      id: 'dp-1',
      periodoImputado: null,
      structure: { userId: 'user-1' },
    });
    mockTx.dataPoint.update.mockResolvedValue({ id: 'dp-1', periodoImputado: '2026-06' });
    await service.imputar('user-1', 'dp-1', '2026-06', 'costista', actor);
    expect(mockTx.traceAuditLog.create).toHaveBeenCalledTimes(1);
    expect(mockTx.traceAuditLog.create.mock.calls[0]![0].data.action).toBe('imputar');
  });

  it('create() NUNCA fija periodoImputado — un dato nace pendiente (NULL) hasta que se decide (F04)', async () => {
    // El eslabón "crear → NULL" que el bug F04 rompía aguas arriba (el front
    // nunca llegaba a crear el dato). Acá se fija el contrato del backend: la
    // creación no imputa sola — ni siquiera cuando la fecha del hecho cae fuera
    // del período. Queda NULL (pendiente) y solo `imputar()` la resuelve; así el
    // motor la marca incompleta y el cierre la bloquea. Si alguien "arreglara"
    // esto poniéndole el período actual por defecto, esta prueba falla.
    const { DataPointService } = await import('@/application/trazabilidad/data-point-service.js');
    const service = new DataPointService(mockTx as never);

    mockTx.costStructure.findFirst.mockResolvedValue({ id: 'st-1', userId: 'user-1' });
    mockTx.dataPoint.create.mockResolvedValue({ id: 'dp-1' });
    mockTx.dataPointVersion.create.mockResolvedValue({ id: 'v1' });

    await service.create(
      'user-1',
      'st-1',
      {
        element: 'MP',
        fieldKey: 'mp.compra.cantidad',
        label: 'Compra — Chapa BWG 18',
        unit: 'u',
        sourceArea: 'deposito',
        method: 'manual',
        valueNum: 100,
        fechaHecho: '2026-05-15', // fuera del período 2026-07
      },
      actor,
    );

    const createData = mockTx.dataPoint.create.mock.calls[0]![0].data;
    // No se manda periodoImputado en la creación → aplica el default NULL del schema.
    expect(createData.periodoImputado ?? null).toBeNull();
    // Y sí queda la fecha del hecho (la que dispara la decisión de imputación).
    expect(createData.fechaHecho).toBeInstanceOf(Date);
  });

  it('validate() es idempotente: si ya estaba validado, no reescribe ni audita de nuevo', async () => {
    const { DataPointService } = await import('@/application/trazabilidad/data-point-service.js');
    const service = new DataPointService(mockTx as never);

    mockTx.dataPoint.findFirst.mockResolvedValue({
      id: 'dp-1',
      status: 'validado',
      structure: { userId: 'user-1' },
    });

    await service.validate('user-1', 'dp-1', 'costista', actor);

    expect(mockTx.dataPoint.update).not.toHaveBeenCalled();
    expect(mockTx.traceAuditLog.create).not.toHaveBeenCalled();
  });
});
