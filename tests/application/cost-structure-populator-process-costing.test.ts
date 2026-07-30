import { describe, it, expect, vi, beforeEach } from 'vitest';
import { populateCostStructureFromApproval } from '@/application/validaciones/cost-structure-populator.js';

/**
 * Bug reportado 2026-07-30: para empresas que usan Costeo por Procesos, un
 * documento se clasificaba bien pero "no se volcaba en las estructuras" tras
 * aprobarlo. Causa real: el populador solo sabe escribir en
 * rawMaterialConfig/directLaborConfig/indirectCostConfig (JSON legado), y
 * NINGÚN servicio del motor de Costeo por Procesos (ProcessDepartment,
 * UnitMovementSchedule, JointCostAllocation) lee esos campos — el dato se
 * perdía en silencio, sin error, sin alerta.
 */
const db = {
  costStructure: { findFirst: vi.fn(), update: vi.fn() },
  costPeriod: { findFirst: vi.fn(), update: vi.fn() },
};

const alerts = { create: vi.fn() };

function service() {
  return db as never;
}

const baseStructure = {
  id: 'st-1',
  companyId: 'co-1',
  userId: 'user-1',
  productName: 'Producto Estrella',
  period: '2026-07',
  status: 'ACTIVE',
  rawMaterialConfig: null,
  directLaborConfig: null,
  indirectCostConfig: null,
};

const reviewNote = JSON.stringify({
  sections: {
    rawMaterial: {
      present: true,
      wilson: { annualDemand: 1000, orderCost: 50, holdingRate: 0.3, unitCost: 10 },
      movements: [{ date: '2026-07-01', type: 'purchase', detail: 'Compra', quantity: 100, unitCost: 10 }],
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  db.costPeriod.findFirst.mockResolvedValue(null); // sin períodos: modo legado
});

describe('populateCostStructureFromApproval — Costeo por Procesos', () => {
  it('NO escribe en rawMaterialConfig para una estructura PROCESSES, y avisa con un SystemAlert', async () => {
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'PROCESSES' });

    await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1',
        costistId: 'user-1',
        costSection: 'MATERIA_PRIMA',
        reviewNote,
        supplier: 'Proveedor SRL',
      },
      alerts as never,
    );

    expect(db.costStructure.update).not.toHaveBeenCalled();
    expect(alerts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'populator',
        level: 'warning',
        message: expect.stringContaining('Materia Prima'),
      }),
    );
  });

  it('si falla al escribir (ej. período cerrado), genera un SystemAlert en vez de perder el dato en silencio', async () => {
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'ORDERS' });
    // requireWritablePeriod: hay un período pero está cerrado → tira ValidationError.
    db.costPeriod.findFirst
      .mockResolvedValueOnce(null) // findOpenPeriod: no hay ninguno abierto
      .mockResolvedValueOnce({ id: 'per-1', label: 'Julio 2026', status: 'CLOSED' }); // último período

    await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1',
        costistId: 'user-1',
        costSection: 'MATERIA_PRIMA',
        reviewNote,
        supplier: 'Proveedor SRL',
      },
      alerts as never,
    );

    expect(db.costStructure.update).not.toHaveBeenCalled();
    expect(alerts.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'populator', level: 'error' }),
    );
  });

  it('sigue poblando rawMaterialConfig normalmente para una estructura ORDERS (sin regresión)', async () => {
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'ORDERS' });

    await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1',
        costistId: 'user-1',
        costSection: 'MATERIA_PRIMA',
        reviewNote,
        supplier: 'Proveedor SRL',
      },
      alerts as never,
    );

    expect(db.costStructure.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'st-1' },
        data: expect.objectContaining({ rawMaterialConfig: expect.any(Object) }),
      }),
    );
    expect(alerts.create).not.toHaveBeenCalled();
  });
});
