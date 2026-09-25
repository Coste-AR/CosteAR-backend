import { describe, expect, it, vi } from 'vitest';
import { CATEGORIA_AVICOLA_POSTURA, PAQUETE_AVICOLA_POSTURA } from '@/application/operacion/paquete-avicola.js';
import { aplicarParametrosSemilla } from '../../prisma/seed-paquete-avicola.js';

describe('paquete avícola de postura', () => {
  it('declara léxico, variantes sin confirmar, parámetros sin confirmar y reglas configurables', () => {
    expect(PAQUETE_AVICOLA_POSTURA).toMatchSnapshot();
    expect(CATEGORIA_AVICOLA_POSTURA).toBe('AVICOLA_POSTURA');
    expect(PAQUETE_AVICOLA_POSTURA.nombreProducto).toBe('AVI');
    expect(PAQUETE_AVICOLA_POSTURA.lexicon.UnidadProductiva).toBe('Galpón');
    expect(PAQUETE_AVICOLA_POSTURA.variants.every((variante) => !variante.confirmado)).toBe(true);
    expect(PAQUETE_AVICOLA_POSTURA.alertRules).toHaveLength(5);
    expect(PAQUETE_AVICOLA_POSTURA.modulos).toHaveLength(8);
    expect(PAQUETE_AVICOLA_POSTURA.modulos.find((modulo) => modulo.clave === 'peso'))
      .toMatchObject({ activoPorDefecto: false, dependeDe: ['plantel'], superficies: ['carga.muestreo-peso'] });
    expect(PAQUETE_AVICOLA_POSTURA.modulos.filter((modulo) => modulo.activoPorDefecto).map((modulo) => modulo.clave))
      .toEqual(['produccion', 'plantel']);
    expect(PAQUETE_AVICOLA_POSTURA.seedParameters.find((parametro) => parametro.clave === 'unidad_carga'))
      .toMatchObject({ tipo: 'texto', opciones: expect.arrayContaining([{ valor: 'cajon', etiqueta: 'Cajón' }]) });
    expect(PAQUETE_AVICOLA_POSTURA.screens.indicadoresMacro.map((indicador) => indicador.clave)).toEqual([
      'USD_BLUE',
      'CAPIA_HUEVO_BLANCO_CAJON',
      'CAPIA_HUEVO_COLOR_CAJON',
      'CAPIA_ALIMENTO_PONEDORA_KG',
      'CAPIA_MAIZ_TON',
      'CAPIA_SOJA_TON',
      'CAPIA_MAPLE_UNIDAD',
    ]);
    expect(PAQUETE_AVICOLA_POSTURA.screens.home.kpis).toEqual([
      { clave: 'costo_cajon', etiqueta: 'Costo por cajón', unidad: 'ARS/cajon', campo: 'costoPorCajon.total' },
      { clave: 'contribucion_marginal_cajon', etiqueta: 'Contribución marginal por cajón', unidad: 'ARS/cajon', campo: 'contribucionMarginalPorCajon' },
      { clave: 'punto_equilibrio', etiqueta: 'Punto de equilibrio', unidad: 'cajones', campo: 'puntoEquilibrioCajones' },
    ]);
  });

  it('no pisa un parámetro confirmado al reejecutar el seed', async () => {
    const create = vi.fn();
    const db = { parametroCosteo: { findFirst: vi.fn(async () => ({ confirmado: true, valorNum: 99 })), create } };
    await aplicarParametrosSemilla(db as never, { companyId: 'company', userId: 'user' });
    expect(create).not.toHaveBeenCalled();
  });
});
