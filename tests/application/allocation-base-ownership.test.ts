import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AllocationBaseService } from '@/application/cost-structures/allocation-base-service.js';
import { NotFoundError } from '@/domain/errors/domain-error.js';

/**
 * Hallazgo de la auditoría de aislamiento (2026-07-29): listCatalog y
 * createCustom tomaban un companyId provisto por el cliente sin verificar
 * que le perteneciera al usuario autenticado — cualquier costista podía leer
 * o escribir el catálogo de bases de asignación de OTRO costista con solo
 * conocer/adivinar su companyId. Este test cubre el fix (requireCompany).
 */
const db = {
  company: { findFirst: vi.fn() },
  allocationBase: { findMany: vi.fn(), create: vi.fn() },
};

function service() {
  return new AllocationBaseService(db as never);
}

beforeEach(() => vi.clearAllMocks());

describe('AllocationBaseService — aislamiento por empresa', () => {
  describe('listCatalog', () => {
    it('devuelve el catálogo cuando la empresa pertenece al usuario', async () => {
      db.company.findFirst.mockResolvedValue({ id: 'co-1', userId: 'user-1' });
      db.allocationBase.findMany.mockResolvedValue([{ id: 'b-1' }]);

      const result = await service().listCatalog('user-1', 'co-1');

      expect(db.company.findFirst).toHaveBeenCalledWith({ where: { id: 'co-1', userId: 'user-1' } });
      expect(result).toEqual([{ id: 'b-1' }]);
    });

    it('rechaza con NotFoundError si la empresa no es del usuario (o no existe)', async () => {
      db.company.findFirst.mockResolvedValue(null);

      await expect(service().listCatalog('user-1', 'co-de-otro-costista')).rejects.toThrow(NotFoundError);
      expect(db.allocationBase.findMany).not.toHaveBeenCalled();
    });
  });

  describe('createCustom', () => {
    it('crea la base cuando la empresa pertenece al usuario', async () => {
      db.company.findFirst.mockResolvedValue({ id: 'co-1', userId: 'user-1' });
      db.allocationBase.create.mockResolvedValue({ id: 'b-new' });

      const result = await service().createCustom('user-1', 'co-1', {
        code: 'horas_maquina',
        name: 'Horas máquina',
        unit: 'hs',
      });

      expect(db.allocationBase.create).toHaveBeenCalled();
      expect(result).toEqual({ id: 'b-new' });
    });

    it('rechaza con NotFoundError si la empresa no es del usuario — no crea nada', async () => {
      db.company.findFirst.mockResolvedValue(null);

      await expect(
        service().createCustom('user-1', 'co-de-otro-costista', { code: 'x', name: 'X', unit: 'u' }),
      ).rejects.toThrow(NotFoundError);
      expect(db.allocationBase.create).not.toHaveBeenCalled();
    });
  });
});
