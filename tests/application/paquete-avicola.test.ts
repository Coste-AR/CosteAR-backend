import { describe, expect, it, vi } from 'vitest';
import { CATEGORIA_AVICOLA_POSTURA, PAQUETE_AVICOLA_POSTURA } from '@/application/operacion/paquete-avicola.js';
import { aplicarParametrosSemilla } from '../../prisma/seed-paquete-avicola.js';

describe('paquete avícola de postura', () => {
  it('declara léxico, variantes sin confirmar, parámetros sin confirmar y reglas configurables', () => {
    expect(CATEGORIA_AVICOLA_POSTURA).toBe('AVICOLA_POSTURA');
    expect(PAQUETE_AVICOLA_POSTURA.lexicon.UnidadProductiva).toBe('Galpón');
    expect(PAQUETE_AVICOLA_POSTURA.variants.every((variante) => !variante.confirmado)).toBe(true);
    expect(PAQUETE_AVICOLA_POSTURA.seedParameters.every((parametro) => !parametro.confirmado)).toBe(true);
    expect(PAQUETE_AVICOLA_POSTURA.alertRules).toHaveLength(5);
  });

  it('no pisa un parámetro confirmado al reejecutar el seed', async () => {
    const create = vi.fn();
    const db = { parametroCosteo: { findFirst: vi.fn(async () => ({ confirmado: true, valorNum: 99 })), create } };
    await aplicarParametrosSemilla(db as never, { companyId: 'company', userId: 'user' });
    expect(create).not.toHaveBeenCalled();
  });
});
