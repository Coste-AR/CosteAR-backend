import { Decimal } from 'decimal.js';

export type CriterioRankingRotacion = 'rendimiento' | 'margen';

export interface ProductoRotacion {
  producto: string;
  margen: number;
  rotacion: number;
  rotacionOrigen: 'DECLARADA' | 'DEFAULT';
}

export function rankingRotacion(productos: ProductoRotacion[], criterio: CriterioRankingRotacion = 'rendimiento') {
  return productos
    .map((producto) => ({ ...producto, rendimiento: new Decimal(producto.rotacion).times(producto.margen).toNumber() }))
    .sort((a, b) => criterio === 'margen'
      ? b.margen - a.margen || a.producto.localeCompare(b.producto)
      : b.rendimiento - a.rendimiento || a.producto.localeCompare(b.producto));
}
