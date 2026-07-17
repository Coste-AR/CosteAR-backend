import { describe, it, expect, vi } from 'vitest';
import {
  requireWritablePeriod,
  mirrorToOpenPeriod,
} from '@/application/cost-structures/period-sync.js';
import { ValidationError } from '@/domain/errors/domain-error.js';

/**
 * C — Fase 3: el período abierto es dueño de los datos de su mes.
 *
 * La app escribe en la estructura; acá se verifica que esa escritura (a) no entre
 * en un mes cerrado, y (b) quede espejada en el período abierto. Sin el espejo,
 * el período guardaría la foto del día que se abrió: el cierre validaría datos
 * viejos y el mes siguiente arrastraría una existencia que no fue la real.
 */

const STRUCTURE = 'struct-1';
const abierto = { id: 'per-julio', label: 'Julio 2026', status: 'OPEN' };
const cerrado = { id: 'per-junio', label: 'Junio 2026', status: 'CLOSED' };

function db(periods: Record<string, unknown>[]) {
  return {
    costPeriod: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where.status === 'OPEN'
          ? (periods.find((p) => p.status === 'OPEN') ?? null)
          : (periods[0] ?? null),
      ),
      update: vi.fn(async () => ({})),
    },
  };
}

describe('requireWritablePeriod', () => {
  it('con período abierto, devuelve ese período: ahí va la escritura', async () => {
    const d = db([abierto]);
    await expect(requireWritablePeriod(d as never, STRUCTURE)).resolves.toMatchObject({
      id: 'per-julio',
    });
  });

  it('con el mes cerrado, no deja escribir y explica qué hacer', async () => {
    const d = db([cerrado]);
    await expect(requireWritablePeriod(d as never, STRUCTURE)).rejects.toThrow(ValidationError);
    await expect(requireWritablePeriod(d as never, STRUCTURE)).rejects.toThrow(/Junio 2026/);
  });

  it('estructura sin períodos (legado): sigue funcionando como siempre', async () => {
    const d = db([]);
    await expect(requireWritablePeriod(d as never, STRUCTURE)).resolves.toBeNull();
  });
});

describe('mirrorToOpenPeriod', () => {
  it('lo que se guarda en la estructura queda también en el período abierto', async () => {
    const d = db([abierto]);
    await mirrorToOpenPeriod(d as never, STRUCTURE, { salesQuantity: 120 });

    expect(d.costPeriod.update).toHaveBeenCalledWith({
      where: { id: 'per-julio' },
      data: { salesQuantity: 120 },
    });
  });

  it('sin período abierto no espeja nada (y no rompe)', async () => {
    const d = db([]);
    await mirrorToOpenPeriod(d as never, STRUCTURE, { salesQuantity: 120 });

    expect(d.costPeriod.update).not.toHaveBeenCalled();
  });
});
