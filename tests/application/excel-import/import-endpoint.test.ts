import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { CostStructureService } from '../../../src/application/cost-structures/cost-structure-service.js';

/**
 * Test del método de servicio detrás de `POST /cost-structures/:id/import-excel`.
 * Se mockea Prisma (mismo patrón que tests/auth/refresh-rotation.test.ts) para
 * verificar, sin base viva, que el import:
 *  1. respeta el scoping por usuario (reusa requireStructure → NotFoundError),
 *  2. devuelve el resultado parseado con la forma esperada,
 *  3. NUNCA persiste nada (no llama a ningún update/create de Prisma).
 */

async function fixtureBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ventas = wb.addWorksheet('4-Estado de Costos');
  ventas.addRow(['Precio unitario de venta', 12000]);
  ventas.addRow(['Cantidad vendida', 1200]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('CostStructureService.importFromExcel', () => {
  it('tira NotFoundError si la estructura no existe o no es del usuario', async () => {
    const db = {
      costStructure: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn(),
      },
    } as never;

    const service = new CostStructureService(db);
    const buffer = await fixtureBuffer();

    await expect(
      service.importFromExcel('user-1', 'struct-1', buffer.toString('base64')),
    ).rejects.toThrow(/no encontrada/);
  });

  it('devuelve el resultado parseado para una estructura válida y un .xlsx válido', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'struct-1', userId: 'user-1' });
    const update = vi.fn();
    const create = vi.fn();
    const db = {
      costStructure: { findFirst, update, create },
    } as never;

    const service = new CostStructureService(db);
    const buffer = await fixtureBuffer();

    const result = await service.importFromExcel('user-1', 'struct-1', buffer.toString('base64'));

    expect(result).toBeDefined();
    expect(result).toHaveProperty('rawMaterialConfig');
    expect(result).toHaveProperty('directLaborConfig');
    expect(result).toHaveProperty('indirectCostConfig');
    expect(result.sales).toEqual({ salesUnitPrice: 12000, salesQuantity: 1200 });

    // Scoping: requireStructure debe haber consultado por id + userId.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'struct-1', userId: 'user-1' }) }),
    );
  });

  it('no persiste nada: no llama a update ni create de Prisma', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'struct-1', userId: 'user-1' });
    const update = vi.fn();
    const create = vi.fn();
    const db = {
      costStructure: { findFirst, update, create },
    } as never;

    const service = new CostStructureService(db);
    const buffer = await fixtureBuffer();

    await service.importFromExcel('user-1', 'struct-1', buffer.toString('base64'));

    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('propaga el error si el base64 no decodifica a un .xlsx válido', async () => {
    const db = {
      costStructure: {
        findFirst: vi.fn().mockResolvedValue({ id: 'struct-1', userId: 'user-1' }),
        update: vi.fn(),
        create: vi.fn(),
      },
    } as never;

    const service = new CostStructureService(db);
    const notXlsxBase64 = Buffer.from('esto no es un excel').toString('base64');

    await expect(
      service.importFromExcel('user-1', 'struct-1', notXlsxBase64),
    ).rejects.toThrow();
  });
});
