export const CATEGORIA_AVICOLA_POSTURA = 'AVICOLA_POSTURA';

/** El primer perfil que consume la escala del paquete es el de postura. */
export const CATEGORY_BY_INDUSTRY = {
  AVICULTURA: CATEGORIA_AVICOLA_POSTURA,
} as const;

/** Contenido declarativo del paquete; no contiene reglas de dominio. */
export const PAQUETE_AVICOLA_POSTURA = {
  nombreProducto: 'AVI',
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
  // Es el catálogo que consume la API. El motor conserva sus defaults puros
  // para calcular, pero preguntas, etiquetas y opciones viven en el paquete:
  // sumar un rubro no puede requerir que el frontend conozca estas claves.
  seedParameters: [
    { clave: 'umbral_variacion_punto_equilibrio_pct', descripcion: 'Variación porcentual que dispara una alerta de punto de equilibrio.', valor: 10, seguro: false },
    { clave: 'huevos_por_cajon', descripcion: 'Huevos que entran en un cajón.', valor: 360, unidad: 'huevo', seguro: true },
    { clave: 'huevos_por_maple', descripcion: 'Huevos que entran en un maple.', valor: 30, unidad: 'huevo', seguro: true },
    { clave: 'maples_por_cajon', descripcion: 'Maples que entran en un cajón.', valor: 12, unidad: 'maple', seguro: true },
    { clave: 'costo_maple', descripcion: 'Costo unitario del maple.', valor: 200, seguro: false },
    { clave: 'gramaje_estandar_gr', descripcion: 'Gramos de alimento por ave por día.', valor: 120, seguro: false },
    { clave: 'vida_util_lote_meses', descripcion: 'Meses de vida productiva del lote.', valor: 24, seguro: false },
    { clave: 'vida_util_producto_dias', descripcion: 'Días de vida útil del producto terminado.', valor: 7, unidad: 'dia', seguro: false },
    { clave: 'tamanos_huevo', descripcion: 'Cantidad de tamaños de huevo que se separan.', valor: 3, seguro: false },
    { clave: 'umbral_merma_normal_pct', descripcion: 'Porcentaje de merma considerado normal.', valor: 0, seguro: false },
    {
      clave: 'unidad_carga', descripcion: 'Cuando anotan la producción del día, ¿en qué la anotan?',
      tipo: 'texto', opciones: [
        { valor: 'huevo', etiqueta: 'Huevo' }, { valor: 'maple', etiqueta: 'Maple' }, { valor: 'cajon', etiqueta: 'Cajón' },
      ],
    },
    {
      clave: 'unidad_gestion', descripcion: '¿En qué unidad querés ver los costos y el precio?',
      tipo: 'unidad_gestion', opciones: [
        { valor: 'huevo', etiqueta: 'Huevo' }, { valor: 'maple', etiqueta: 'Maple' }, { valor: 'cajon', etiqueta: 'Cajón' },
      ],
    },
    {
      clave: 'alimento_origen', descripcion: '¿El alimento lo comprás hecho o lo preparás vos?',
      tipo: 'texto', opciones: [
        { valor: 'compro', etiqueta: 'Lo compro hecho' }, { valor: 'preparo', etiqueta: 'Lo preparo' }, { valor: 'mixto', etiqueta: 'Ambas opciones' },
      ],
      propuestaModulo: { valores: ['preparo', 'mixto'], clave: 'alimento' },
    },
  ],
  alertRules: [
    { indicador: 'nivel_deposito_bajo', condicion: 'MENOR', umbral: 'configurable' },
    { indicador: 'humedad_ingreso', condicion: 'MAYOR', umbral: 'configurable' },
    { indicador: 'postura_media_movil', condicion: 'MENOR', umbral: 'configurable' },
    { indicador: 'antiguedad_stock', condicion: 'MAYOR', umbral: 'configurable' },
    { indicador: 'desvio_consumo', condicion: 'MAYOR', umbral: 'configurable' },
  ],
  screens: {
    home: {
      kpis: [
        { clave: 'costo_cajon', etiqueta: 'Costo por cajón', unidad: 'ARS/cajon', campo: 'costoPorCajon.total' },
        { clave: 'contribucion_marginal_cajon', etiqueta: 'Contribución marginal por cajón', unidad: 'ARS/cajon', campo: 'contribucionMarginalPorCajon' },
        { clave: 'punto_equilibrio', etiqueta: 'Punto de equilibrio', unidad: 'cajones', campo: 'puntoEquilibrioCajones' },
      ],
    },
    /** Indicadores externos propios del rubro que acompañan al dólar oficial
     * y al IPC del núcleo. La lista es contenido del paquete, no del tenant. */
    indicadoresMacro: [
      { clave: 'USD_BLUE', etiqueta: 'Dólar blue', unidad: 'ARS/USD', fuente: 'DOLARAPI' },
      { clave: 'CAPIA_HUEVO_BLANCO_CAJON', etiqueta: 'Huevo blanco', unidad: 'cajon', fuente: 'CAPIA' },
      { clave: 'CAPIA_HUEVO_COLOR_CAJON', etiqueta: 'Huevo color', unidad: 'cajon', fuente: 'CAPIA' },
      { clave: 'CAPIA_ALIMENTO_PONEDORA_KG', etiqueta: 'Alimento ponedora', unidad: 'kg', fuente: 'CAPIA' },
      { clave: 'CAPIA_MAIZ_TON', etiqueta: 'Maíz', unidad: 'ton', fuente: 'CAPIA' },
      { clave: 'CAPIA_SOJA_TON', etiqueta: 'Soja', unidad: 'ton', fuente: 'CAPIA' },
      { clave: 'CAPIA_MAPLE_UNIDAD', etiqueta: 'Maple', unidad: 'unidad', fuente: 'CAPIA' },
    ],
  },
  modulos: [
    {
      clave: 'produccion',
      nombre: 'Producción diaria',
      descripcion: 'Registrá lo que produjo cada lote durante el día.',
      superficies: ['carga.produccion-diaria'],
      parametros: ['huevos_por_cajon', 'huevos_por_maple', 'maples_por_cajon', 'costo_maple', 'unidad_carga', 'unidad_gestion'],
      alertas: [],
      dependeDe: [],
      activoPorDefecto: true,
    },
    {
      clave: 'plantel',
      nombre: 'Plantel',
      descripcion: 'Registrá bajas y otros eventos del lote.',
      superficies: ['carga.bajas-plantel'],
      parametros: ['vida_util_lote_meses'],
      alertas: ['postura_media_movil'],
      dependeDe: [],
      activoPorDefecto: true,
    },
    {
      clave: 'variantes', nombre: 'Tipos de producto', descripcion: 'Separá la producción por tipo y repartí el costo entre ellos.',
      superficies: ['tablero.variantes'], parametros: [], alertas: [], dependeDe: ['produccion'], activoPorDefecto: false,
    },
    {
      clave: 'depositos', nombre: 'Silos', descripcion: 'Registrá el nivel del depósito y sus alertas de reposición.',
      superficies: ['carga.depositos'], parametros: [], alertas: ['nivel_deposito_bajo', 'humedad_ingreso', 'antiguedad_stock'], dependeDe: [], activoPorDefecto: false,
    },
    {
      clave: 'alimento', nombre: 'Alimento propio', descripcion: 'Registrá bachadas, fórmulas activas y consumo por lote.',
      superficies: ['carga.alimento-propio'], parametros: ['gramaje_estandar_gr', 'alimento_origen'], alertas: ['desvio_consumo'], dependeDe: [], activoPorDefecto: false,
    },
    {
      clave: 'peso', nombre: 'Muestreo de peso', descripcion: 'Registrá peso por muestreo contra tabla estándar.',
      superficies: ['carga.muestreo-peso'], parametros: [], alertas: [], dependeDe: ['plantel'], activoPorDefecto: false,
    },
    {
      clave: 'amortizacion_plantel', nombre: 'Plantel como activo', descripcion: 'Amortizá el lote en vez de imputarlo al período.',
      superficies: ['costeo.amortizacion-plantel'], parametros: ['vida_util_lote_meses'], alertas: [], dependeDe: ['plantel'], activoPorDefecto: false,
    },
    {
      clave: 'desperdicio', nombre: 'Desperdicio', descripcion: 'Registrá mermas con su naturaleza declarada.',
      superficies: ['carga.desperdicio'], parametros: ['umbral_merma_normal_pct'], alertas: [], dependeDe: [], activoPorDefecto: false,
    },
  ],
} as const;
