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
  processDepartment: { findFirst: vi.fn() },
  unitMovementSchedule: { upsert: vi.fn(), findUnique: vi.fn() },
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

describe('populateCostStructureFromApproval — Costeo por Procesos, con departamento asignado', () => {
  const openPeriod = { id: 'per-1', label: 'Julio 2026', status: 'OPEN' };

  beforeEach(() => {
    db.costPeriod.findFirst.mockResolvedValue(openPeriod); // findOpenPeriod: hay uno abierto
    db.processDepartment.findFirst.mockResolvedValue({ id: 'dept-1', name: 'Mezclado' });
    db.unitMovementSchedule.upsert.mockResolvedValue({});
    db.unitMovementSchedule.findUnique.mockResolvedValue(null); // todavía no existe el cuadro
  });

  it('acumula el monto en periodCostMp (fila nueva)', async () => {
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'PROCESSES' });

    const result = await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1',
        costistId: 'user-1',
        costSection: 'MATERIA_PRIMA',
        reviewNote,
        supplier: 'Proveedor SRL',
        amount: 15000,
        processDepartmentId: 'dept-1',
      },
      alerts as never,
    );

    expect(result.populated).toBe(true);
    expect(result.skippedReason).toBeUndefined();
    expect(db.unitMovementSchedule.upsert).toHaveBeenCalledWith({
      where: { departmentId_periodId: { departmentId: 'dept-1', periodId: 'per-1' } },
      create: { departmentId: 'dept-1', periodId: 'per-1', periodCostMp: 15000 },
      update: { periodCostMp: 15000 },
    });
    // Nunca escribe en el JSON legado, aunque haya departamento.
    expect(db.costStructure.update).not.toHaveBeenCalled();
  });

  // Bug de verificación manual 2026-07-30: con `{ increment }` de Prisma, un
  // campo que arranca en NULL (nadie cargó todavía ese elemento del costo)
  // queda en NULL para siempre — en Postgres `NULL + N` da NULL, no N. Pasó
  // en vivo: MP se acumuló bien (fila nueva), pero MOD sobre esa MISMA fila
  // (que ya existía por MP, con periodCostMo todavía null) quedó silenciosamente
  // en null. Este test fija esa regla: sumar sobre null da el monto, no null.
  it('acumula sobre una fila EXISTENTE cuyo campo todavía es null (no queda en null)', async () => {
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'PROCESSES' });
    db.unitMovementSchedule.findUnique.mockResolvedValue({
      periodCostMp: 45000, periodCostMo: null, periodCostCif: null,
    });
    const laborNote = JSON.stringify({ sections: { directLabor: { present: true, departments: [] } } });

    const result = await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1', costistId: 'user-1', costSection: 'MANO_DE_OBRA',
        reviewNote: laborNote, supplier: null, amount: 32000, processDepartmentId: 'dept-1',
      },
      alerts as never,
    );

    expect(result.populated).toBe(true);
    expect(db.unitMovementSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { periodCostMo: 32000 } }),
    );
  });

  it('un segundo documento del MISMO elemento SUMA sobre el importe ya acumulado (no lo pisa)', async () => {
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'PROCESSES' });
    db.unitMovementSchedule.findUnique.mockResolvedValue({
      periodCostMp: 15000, periodCostMo: null, periodCostCif: null,
    });

    await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1', costistId: 'user-1', costSection: 'MATERIA_PRIMA',
        reviewNote, supplier: null, amount: 5000, processDepartmentId: 'dept-1',
      },
      alerts as never,
    );

    expect(db.unitMovementSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { periodCostMp: 20000 } }),
    );
  });

  it('MANO_DE_OBRA acumula en periodCostMo, COSTOS_INDIRECTOS en periodCostCif', async () => {
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'PROCESSES' });
    const laborNote = JSON.stringify({ sections: { directLabor: { present: true, departments: [] } } });

    await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1', costistId: 'user-1', costSection: 'MANO_DE_OBRA',
        reviewNote: laborNote, supplier: null, amount: 8000, processDepartmentId: 'dept-1',
      },
      alerts as never,
    );
    expect(db.unitMovementSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ periodCostMo: 8000 }) }),
    );

    vi.clearAllMocks();
    db.costPeriod.findFirst.mockResolvedValue(openPeriod);
    db.processDepartment.findFirst.mockResolvedValue({ id: 'dept-1', name: 'Mezclado' });
    db.unitMovementSchedule.upsert.mockResolvedValue({});
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'PROCESSES' });
    const cifNote = JSON.stringify({ sections: { indirectCosts: { present: true, centers: [], concepts: [] } } });

    await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1', costistId: 'user-1', costSection: 'COSTOS_INDIRECTOS',
        reviewNote: cifNote, supplier: null, amount: 3000, processDepartmentId: 'dept-1',
      },
      alerts as never,
    );
    expect(db.unitMovementSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ periodCostCif: 3000 }) }),
    );
  });

  it('sin departamento asignado, queda pendiente (no llama upsert) y avisa por qué', async () => {
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'PROCESSES' });

    const result = await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1', costistId: 'user-1', costSection: 'MATERIA_PRIMA',
        reviewNote, supplier: null, amount: 15000, processDepartmentId: null,
      },
      alerts as never,
    );

    expect(result.populated).toBe(false);
    expect(result.skippedReason).toContain('cola de pendientes');
    expect(db.unitMovementSchedule.upsert).not.toHaveBeenCalled();
  });

  it('sin monto reconocible, no acumula (no inventa un importe)', async () => {
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'PROCESSES' });

    const result = await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1', costistId: 'user-1', costSection: 'MATERIA_PRIMA',
        reviewNote, supplier: null, amount: null, processDepartmentId: 'dept-1',
      },
      alerts as never,
    );

    expect(result.populated).toBe(false);
    expect(result.skippedReason).toContain('monto');
    expect(db.unitMovementSchedule.upsert).not.toHaveBeenCalled();
  });

  it('el departamento asignado no pertenece a esta estructura → no acumula (aislamiento)', async () => {
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'PROCESSES' });
    db.processDepartment.findFirst.mockResolvedValue(null); // el where filtra por structureId: no matchea

    const result = await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1', costistId: 'user-1', costSection: 'MATERIA_PRIMA',
        reviewNote, supplier: null, amount: 15000, processDepartmentId: 'dept-de-otra-estructura',
      },
      alerts as never,
    );

    expect(result.populated).toBe(false);
    expect(result.skippedReason).toContain('no existe o ya no pertenece');
    expect(db.unitMovementSchedule.upsert).not.toHaveBeenCalled();
  });

  it('sin períodos de costeo creados todavía, avisa en vez de fallar', async () => {
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'PROCESSES' });
    db.costPeriod.findFirst.mockResolvedValue(null); // ni abierto ni ninguno creado

    const result = await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1', costistId: 'user-1', costSection: 'MATERIA_PRIMA',
        reviewNote, supplier: null, amount: 15000, processDepartmentId: 'dept-1',
      },
      alerts as never,
    );

    expect(result.populated).toBe(false);
    expect(result.skippedReason).toContain('períodos de costeo');
    expect(db.unitMovementSchedule.upsert).not.toHaveBeenCalled();
  });

  // Bug encontrado en verificación manual 2026-07-30: assignDepartment() (cola
  // de pendientes) llama a este populador para un documento YA aprobado, cuyo
  // reviewNote puede no venir seteado (viene de un DataEntry viejo, o creado
  // por un camino que nunca guardó el JSON de la IA). La acumulación en
  // Procesos NO depende de reviewNote — costSection y amount ya llegan
  // explícitos — así que no debe cortar temprano por reviewNote ausente.
  it('acumula igual aunque reviewNote sea null (la cola de pendientes no siempre lo tiene)', async () => {
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'PROCESSES' });

    const result = await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1', costistId: 'user-1', costSection: 'MANO_DE_OBRA',
        reviewNote: null, supplier: null, amount: 32000, processDepartmentId: 'dept-1',
      },
      alerts as never,
    );

    expect(result.populated).toBe(true);
    expect(db.unitMovementSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ periodCostMo: 32000 }) }),
    );
  });

  it('Ventas se sigue poblando en CostStructure aunque el costeo sea por Procesos (sin regresión)', async () => {
    db.costStructure.findFirst.mockResolvedValue({ ...baseStructure, costingSystem: 'PROCESSES' });
    const salesNote = JSON.stringify({ sections: { sales: { present: true, unitPrice: 100, quantity: 5 } } });

    const result = await populateCostStructureFromApproval(
      service(),
      {
        companyId: 'co-1', costistId: 'user-1', costSection: 'VENTAS',
        reviewNote: salesNote, supplier: null,
      },
      alerts as never,
    );

    expect(result.populated).toBe(true);
    expect(db.costStructure.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { salesUnitPrice: 100, salesQuantity: 5 } }),
    );
  });
});
