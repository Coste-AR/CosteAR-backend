import { describe, expect, it } from 'vitest';
import { produccionDiariaCreateSchema } from '@/shared/schemas/produccion-diaria.schema.js';

describe('#195 — contrato de producción diaria', () => {
  it('admite variantes abiertas y rechaza mermas mayores a la producción', () => {
    expect(produccionDiariaCreateSchema.safeParse({
      fecha: '2026-09-02', variante: 'variante_nueva', unidadesProducidas: 8, roturas: 1, descartes: 1,
    }).success).toBe(true);
    expect(produccionDiariaCreateSchema.safeParse({
      fecha: '2026-09-02', variante: 'variante_nueva', unidadesProducidas: 8, roturas: 7, descartes: 2,
    }).success).toBe(false);
  });
});
