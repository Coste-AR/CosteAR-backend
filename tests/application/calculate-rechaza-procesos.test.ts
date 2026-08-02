import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnprocessableEntityError } from '@/domain/errors/domain-error.js';

/**
 * EL BUG DEL MÓDULO "DESCONECTADO" (punto 4.2 del acta del 30/07).
 *
 * `POST /cost-structures/:id/calculate` es el cálculo de Costeo por Órdenes,
 * pero no miraba el sistema de costeo: le corría la matemática de Órdenes a
 * cualquier estructura, incluidas las de Procesos.
 *
 * En Procesos, MP/MOD/CIP viven en el cuadro de movimiento de unidades y no en
 * esos JSON. Al estar vacíos, el costista recibía "cargá MP, MOD y CIP antes de
 * calcular" — un mensaje que le pide llenar campos que en su pantalla no
 * existen. Y si el clasificador los había autopoblado, el cálculo salía igual y
 * PERSISTÍA un costo mal calculado.
 */

const mockDb = {
  costStructure: { findFirst: vi.fn() },
  costCalculation: { create: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockDb,
  withTenant: (_u: string, fn: (tx: unknown) => unknown) => fn(mockDb),
}));

const ctx = { ipAddress: '1.1.1.1', userAgent: 'test' };

async function service() {
  const { CostStructureService } = await import(
    '@/application/cost-structures/cost-structure-service.js'
  );
  return new CostStructureService(mockDb as never);
}

/** Una estructura de Procesos CON los JSON poblados: el caso peligroso. */
const procesosConJsonPoblado = {
  id: 'st-1',
  userId: 'user-1',
  productName: 'Alcohol',
  costingSystem: 'PROCESSES',
  rawMaterialConfig: { materials: [] },
  directLaborConfig: { departments: [] },
  indirectCostConfig: { centers: [], concepts: [] },
  salesUnitPrice: 100,
  salesQuantity: 10,
};

beforeEach(() => vi.clearAllMocks());

describe('El cálculo de Órdenes rechaza las estructuras de Procesos', () => {
  it('no calcula, y dice a dónde ir', async () => {
    mockDb.costStructure.findFirst.mockResolvedValue(procesosConJsonPoblado);
    const svc = await service();

    const promise = svc.calculate('user-1', 'st-1', ctx);

    await expect(promise).rejects.toBeInstanceOf(UnprocessableEntityError);
    // El mensaje tiene que llevar al costista a la pantalla correcta, no dejarlo
    // adivinando: el error viejo le pedía cargar campos que no existen en su
    // pantalla.
    await expect(promise).rejects.toThrow(/Costeo por Procesos/i);
    await expect(promise).rejects.toThrow(/período y por departamento/i);
  });

  it('con los JSON poblados TAMPOCO calcula: es el caso que persistía un número mal', async () => {
    mockDb.costStructure.findFirst.mockResolvedValue(procesosConJsonPoblado);
    const svc = await service();

    await expect(svc.calculate('user-1', 'st-1', ctx)).rejects.toThrow();

    // Lo importante no es que falle: es que NO haya guardado nada.
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.costCalculation.create).not.toHaveBeenCalled();
  });

  it('el rechazo ocurre ANTES de la validación de secciones incompletas', async () => {
    // Con los JSON vacíos, el error viejo era "cargá MP, MOD y CIP". Ese mensaje
    // no puede volver a aparecer en una estructura de Procesos.
    mockDb.costStructure.findFirst.mockResolvedValue({
      ...procesosConJsonPoblado,
      rawMaterialConfig: null,
      directLaborConfig: null,
      indirectCostConfig: null,
    });
    const svc = await service();

    await expect(svc.calculate('user-1', 'st-1', ctx)).rejects.toThrow(/Costeo por Procesos/i);
    await expect(svc.calculate('user-1', 'st-1', ctx)).rejects.not.toThrow(/cargá MP/i);
  });

  it('una estructura de Órdenes sigue calculando como siempre', async () => {
    mockDb.costStructure.findFirst.mockResolvedValue({
      ...procesosConJsonPoblado,
      costingSystem: 'ORDERS',
      rawMaterialConfig: null,
    });
    const svc = await service();

    // Regresión: el camino de Órdenes no cambió. Sigue quejándose por secciones
    // incompletas, que es lo correcto para ella.
    await expect(svc.calculate('user-1', 'st-1', ctx)).rejects.toThrow(/incompleta/i);
  });
});
