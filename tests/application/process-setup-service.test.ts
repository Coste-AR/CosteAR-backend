import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests de ProcessSetupService — persistencia de `unit`/`conversionFromPrevious`
 * por departamento (H12). El resto del setup (nombres, secuencia, coproductos,
 * recuento) ya está cubierto por tests/domain/setup-rules.test.ts; acá se
 * aísla la orquestación de guardado con Prisma mockeado, mismo patrón que
 * unit-movement-service.test.ts.
 */

const mockTx = {
  costStructure: { findFirst: vi.fn(), update: vi.fn() },
  processDepartment: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  operatorMembership: { findMany: vi.fn(), updateMany: vi.fn() },
  traceAuditLog: { create: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockTx,
  withTenant: (_userId: string, fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
}));

const actor = { id: 'user-1', role: 'COSTISTA', area: 'planta', device: 'test-agent · 127.0.0.1' };

function mockProcessStructure() {
  mockTx.costStructure.findFirst.mockResolvedValue({
    id: 'st-1',
    userId: 'user-1',
    productName: 'Jugo de naranja',
    costingSystem: 'PROCESSES',
    setupCompletedAt: null,
  });
  mockTx.costStructure.update.mockResolvedValue({ setupCompletedAt: new Date('2026-08-03') });
  mockTx.operatorMembership.updateMany.mockResolvedValue({ count: 0 });
}

async function makeService() {
  const { ProcessSetupService } = await import(
    '@/application/cost-structures/process-costing/process-setup-service.js'
  );
  return new ProcessSetupService(mockTx as never);
}

describe('ProcessSetupService — unidad y factor de conversión por departamento (H12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('crea los departamentos con su unidad; el primero ignora el factor aunque venga cargado', async () => {
    mockProcessStructure();
    mockTx.processDepartment.findMany.mockResolvedValue([]);
    const service = await makeService();

    await service.complete(
      'user-1',
      'st-1',
      {
        departments: [
          // El primero no recibe de nadie: un factor acá no significa nada,
          // aunque el cliente lo mande (bug del formulario, copy-paste, etc.).
          { name: 'Molienda', sequence: 1, unit: 'toneladas', conversionFromPrevious: 999 },
          { name: 'Destilado', sequence: 2, unit: 'litros', conversionFromPrevious: 550 },
        ],
        hasJointProducts: false,
      },
      actor,
    );

    const creates = mockTx.processDepartment.create.mock.calls.map((c) => c[0].data);
    expect(creates).toEqual([
      { structureId: 'st-1', name: 'Molienda', sequence: 1, unit: 'toneladas', conversionFromPrevious: null },
      { structureId: 'st-1', name: 'Destilado', sequence: 2, unit: 'litros', conversionFromPrevious: 550 },
    ]);
  });

  it('re-correr el wizard actualiza la unidad/factor de un departamento existente', async () => {
    mockProcessStructure();
    mockTx.processDepartment.findMany.mockResolvedValue([
      { id: 'dep-2', name: 'Destilado', sequence: 2, unit: null, conversionFromPrevious: null },
    ]);
    const service = await makeService();

    await service.complete(
      'user-1',
      'st-1',
      {
        departments: [
          { name: 'Molienda', sequence: 1, unit: null, conversionFromPrevious: null },
          { name: 'Destilado', sequence: 2, unit: 'litros', conversionFromPrevious: 550 },
        ],
        hasJointProducts: false,
      },
      actor,
    );

    expect(mockTx.processDepartment.update).toHaveBeenCalledWith({
      where: { id: 'dep-2' },
      data: { name: 'Destilado', unit: 'litros', conversionFromPrevious: 550 },
    });
  });

  it('sin cambios (mismo nombre, unidad y factor) no escribe nada', async () => {
    mockProcessStructure();
    mockTx.processDepartment.findMany.mockResolvedValue([
      { id: 'dep-2', name: 'Destilado', sequence: 2, unit: 'litros', conversionFromPrevious: 550 },
    ]);
    const service = await makeService();

    await service.complete(
      'user-1',
      'st-1',
      {
        departments: [
          { name: 'Molienda', sequence: 1, unit: null, conversionFromPrevious: null },
          { name: 'Destilado', sequence: 2, unit: 'litros', conversionFromPrevious: 550 },
        ],
        hasJointProducts: false,
      },
      actor,
    );

    expect(mockTx.processDepartment.update).not.toHaveBeenCalled();
  });
});
