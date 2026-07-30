import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integración clasificador ↔ Costeo por Procesos (2026-07-30): un documento
 * aprobado sin departamento asignado NUNCA debe perder su monto — o se
 * acumula al aprobar (si ya viene con departamento) o queda visible en la
 * cola de pendientes hasta que alguien lo asigne a mano.
 */
const { mockPopulate } = vi.hoisted(() => ({
  mockPopulate: vi.fn(),
}));

vi.mock('@/application/validaciones/cost-structure-populator.js', () => ({
  populateCostStructureFromApproval: mockPopulate,
}));

import { ValidacionesService } from '@/application/validaciones/validaciones-service.js';

const db = {
  dataEntry: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  processDepartment: { findFirst: vi.fn() },
  costStructure: { findFirst: vi.fn() },
  costLedgerEntry: { findFirst: vi.fn() },
};

const alerts = { create: vi.fn() };

function service() {
  return new ValidacionesService(db as never, alerts as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ValidacionesService.assignDepartment', () => {
  const approvedEntry = {
    id: 'entry-1',
    costistId: 'user-1',
    status: 'APPROVED',
    costStructureId: 'st-1',
    processDepartmentId: null,
    reviewNote: '{}',
    connection: { companyId: 'co-1' },
  };

  it('asigna el departamento y dispara la acumulación cuando hay línea de libro mayor', async () => {
    db.dataEntry.findUnique.mockResolvedValue(approvedEntry);
    db.processDepartment.findFirst.mockResolvedValue({ structure: { id: 'st-1', userId: 'user-1' } });
    db.costLedgerEntry.findFirst.mockResolvedValue({ costSection: 'MATERIA_PRIMA', amount: 15000 });
    mockPopulate.mockResolvedValue({ populated: true });

    const result = await service().assignDepartment('entry-1', 'user-1', 'dept-1');

    expect(db.dataEntry.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: { processDepartmentId: 'dept-1' },
    });
    expect(mockPopulate).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        costSection: 'MATERIA_PRIMA',
        amount: 15000,
        processDepartmentId: 'dept-1',
        costStructureId: 'st-1',
      }),
      alerts,
    );
    expect(result.populationWarning).toBeUndefined();
  });

  it('sin línea de libro mayor (documento sin monto), asigna igual pero avisa que no hay nada para acumular', async () => {
    db.dataEntry.findUnique.mockResolvedValue(approvedEntry);
    db.processDepartment.findFirst.mockResolvedValue({ structure: { id: 'st-1', userId: 'user-1' } });
    db.costLedgerEntry.findFirst.mockResolvedValue(null);

    const result = await service().assignDepartment('entry-1', 'user-1', 'dept-1');

    expect(db.dataEntry.update).toHaveBeenCalled();
    expect(mockPopulate).not.toHaveBeenCalled();
    expect(result.populationWarning).toContain('monto');
  });

  it('rechaza si el documento no está aprobado todavía', async () => {
    db.dataEntry.findUnique.mockResolvedValue({ ...approvedEntry, status: 'PENDING' });

    await expect(service().assignDepartment('entry-1', 'user-1', 'dept-1')).rejects.toThrow(/ya aprobado/);
    expect(db.dataEntry.update).not.toHaveBeenCalled();
  });

  it('rechaza si el documento ya tenía un departamento asignado', async () => {
    db.dataEntry.findUnique.mockResolvedValue({ ...approvedEntry, processDepartmentId: 'dept-viejo' });

    await expect(service().assignDepartment('entry-1', 'user-1', 'dept-1')).rejects.toThrow(/ya tiene un departamento/);
    expect(db.dataEntry.update).not.toHaveBeenCalled();
  });

  it('rechaza un departamento que no pertenece al costista (aislamiento entre cuentas)', async () => {
    db.dataEntry.findUnique.mockResolvedValue(approvedEntry);
    db.processDepartment.findFirst.mockResolvedValue({ structure: { id: 'st-1', userId: 'OTRO-USUARIO' } });

    await expect(service().assignDepartment('entry-1', 'user-1', 'dept-1')).rejects.toThrow(/no pertenece/);
    expect(db.dataEntry.update).not.toHaveBeenCalled();
  });

  it('rechaza un departamento que no corresponde al producto de este documento', async () => {
    db.dataEntry.findUnique.mockResolvedValue(approvedEntry);
    db.processDepartment.findFirst.mockResolvedValue({ structure: { id: 'st-OTRO-PRODUCTO', userId: 'user-1' } });

    await expect(service().assignDepartment('entry-1', 'user-1', 'dept-1')).rejects.toThrow(/no corresponde/);
    expect(db.dataEntry.update).not.toHaveBeenCalled();
  });

  it('entrada de otro costista → ForbiddenError', async () => {
    db.dataEntry.findUnique.mockResolvedValue({ ...approvedEntry, costistId: 'OTRO' });

    await expect(service().assignDepartment('entry-1', 'user-1', 'dept-1')).rejects.toThrow(/permiso/);
  });
});

describe('ValidacionesService.listUnassignedForStructure', () => {
  it('lista solo documentos aprobados de MP/MOD/CIF sin departamento asignado', async () => {
    db.costStructure.findFirst.mockResolvedValue({ id: 'st-1', costingSystem: 'PROCESSES' });
    db.dataEntry.findMany.mockResolvedValue([
      { id: 'e1', classificationAudits: [{ costSection: 'MATERIA_PRIMA' }] },
      { id: 'e2', classificationAudits: [{ costSection: 'VENTAS' }] },
    ]);

    const items = await service().listUnassignedForStructure('user-1', 'st-1');

    expect(db.dataEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          costistId: 'user-1',
          costStructureId: 'st-1',
          processDepartmentId: null,
          status: { in: ['APPROVED', 'CORRECTED'] },
        }),
      }),
    );
    // VENTAS no pertenece a la cola de departamentos.
    expect(items.map((i) => i.id)).toEqual(['e1']);
  });

  it('rechaza si la estructura no es de Costeo por Procesos', async () => {
    db.costStructure.findFirst.mockResolvedValue({ id: 'st-1', costingSystem: 'ORDERS' });

    await expect(service().listUnassignedForStructure('user-1', 'st-1')).rejects.toThrow(/Costeo por Procesos/);
  });

  it('estructura inexistente o de otro costista → NotFoundError', async () => {
    db.costStructure.findFirst.mockResolvedValue(null);

    await expect(service().listUnassignedForStructure('user-1', 'st-ajena')).rejects.toThrow(/no encontrada/);
  });
});

describe('ValidacionesService.review — validación de departamento', () => {
  it('rechaza si el departamento elegido no pertenece a una estructura del costista', async () => {
    db.dataEntry.findUnique.mockResolvedValue({
      id: 'entry-1', costistId: 'user-1', status: 'PENDING', costStructureId: null,
      connection: { companyId: 'co-1' },
    });
    db.processDepartment.findFirst.mockResolvedValue({ structure: { id: 'st-1', userId: 'OTRO' } });

    await expect(
      service().review('entry-1', 'user-1', { status: 'APPROVED', processDepartmentId: 'dept-ajeno' }),
    ).rejects.toThrow(/no pertenece/);
  });
});
