import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostingSystemNotAvailableError } from '@/domain/errors/calculation-errors.js';

/**
 * B02 — DESPACHO POR SISTEMA DE COSTEO (patrón Strategy).
 *
 * `calculate()` elige el motor según `costingSystem`. El de Órdenes ya está
 * extraído y verificado al centavo (sus fixtures siguen byte-idénticos). El de
 * Procesos todavía no existe (llega con B17): calcular una estructura de Procesos
 * NO puede caerse con un 500 crudo, tiene que devolver un 422 accionable en
 * castellano. Este test fija ese contrato del placeholder.
 */

const mockTx = {
  costStructure: { findFirst: vi.fn() },
  dataPoint: { findMany: vi.fn(), findFirst: vi.fn() },
  calculationRun: { findFirst: vi.fn(), create: vi.fn() },
  calculationNode: { create: vi.fn() },
  traceAuditLog: { create: vi.fn(), count: vi.fn(), findMany: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockTx,
  withTenant: (_userId: string, fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
}));

const actor = { id: 'user-1', role: 'COSTISTA', area: 'costista' };

describe('CalculationRunService — costeo por PROCESOS devuelve 422, nunca 500', () => {
  beforeEach(() => vi.clearAllMocks());

  it('🔒 una estructura con costingSystem PROCESSES corta con un 422 accionable en castellano', async () => {
    const { CalculationRunService } = await import('@/application/cost-structures/calculation-run-service.js');
    const service = new CalculationRunService(mockTx as never);

    mockTx.costStructure.findFirst.mockResolvedValue({
      id: 'st-1',
      userId: 'user-1',
      costingSystem: 'PROCESSES',
    });

    const promise = service.calculate('user-1', 'st-1', actor);

    await expect(promise).rejects.toBeInstanceOf(CostingSystemNotAvailableError);
    await expect(promise).rejects.toMatchObject({ statusCode: 422 });
    await expect(service.calculate('user-1', 'st-1', actor)).rejects.toThrow(
      /costeo por procesos todavía no está disponible/i,
    );

    // Cortó ANTES de tocar la persistencia: ni corrida ni nodos ni auditoría.
    expect(mockTx.calculationRun.create).not.toHaveBeenCalled();
    expect(mockTx.calculationNode.create).not.toHaveBeenCalled();
    expect(mockTx.traceAuditLog.create).not.toHaveBeenCalled();
  });

  it('una estructura de ÓRDENES no cae en el placeholder (elige el motor de Órdenes)', async () => {
    const { CalculationRunService } = await import('@/application/cost-structures/calculation-run-service.js');
    const service = new CalculationRunService(mockTx as never);

    // Sin secciones cargadas: el despacho a Órdenes sigue de largo y recién ahí
    // pide cargar Materia Prima. Lo que importa: NO es el 422 de Procesos.
    mockTx.costStructure.findFirst.mockResolvedValue({
      id: 'st-1',
      userId: 'user-1',
      costingSystem: 'ORDERS',
      rawMaterialConfig: null,
    });

    await expect(service.calculate('user-1', 'st-1', actor)).rejects.not.toBeInstanceOf(
      CostingSystemNotAvailableError,
    );
  });
});
