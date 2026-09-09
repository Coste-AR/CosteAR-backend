import { PARAMETROS_AVICOLA } from '../../domain/parametros/parametros-costeo.js';

export const CATEGORIA_AVICOLA_POSTURA = 'AVICOLA_POSTURA';

/** Contenido declarativo del paquete; no contiene reglas de dominio. */
export const PAQUETE_AVICOLA_POSTURA = {
  lexicon: {
    UnidadProductiva: 'Galpón',
    LoteProductivo: 'Lote de aves',
    Deposito: 'Silo',
    CorridaProduccion: 'Bachada',
  },
  icons: { UnidadProductiva: 'warehouse', LoteProductivo: 'bird', Deposito: 'container', CorridaProduccion: 'flask' },
  // La cantidad de variantes sigue pendiente de confirmación. Son etiquetas
  // provisionales de paquete, no una afirmación sobre ningún cliente.
  variants: [
    { codigo: 'variante_1', etiqueta: 'Variante 1', confirmado: false },
    { codigo: 'variante_2', etiqueta: 'Variante 2', confirmado: false },
  ],
  seedParameters: PARAMETROS_AVICOLA.map((parametro) => ({
    clave: parametro.clave,
    valor: parametro.valorDefault,
    confirmado: false,
  })),
  alertRules: [
    { indicador: 'nivel_deposito_bajo', condicion: 'MENOR', umbral: 'configurable' },
    { indicador: 'humedad_ingreso', condicion: 'MAYOR', umbral: 'configurable' },
    { indicador: 'postura_media_movil', condicion: 'MENOR', umbral: 'configurable' },
    { indicador: 'antiguedad_stock', condicion: 'MAYOR', umbral: 'configurable' },
    { indicador: 'desvio_consumo', condicion: 'MAYOR', umbral: 'configurable' },
  ],
  screens: {},
} as const;
