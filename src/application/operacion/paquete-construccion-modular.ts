export const CATEGORIA_CONSTRUCCION_MODULAR = 'CONSTRUCCION_MODULAR';

/** Contenido declarativo del paquete; no contiene fórmulas ni datos de una empresa. */
export const PAQUETE_CONSTRUCCION_MODULAR = {
  nombreProducto: 'Construcción Modular',
  nombreProductoConfirmado: false,
  lexicon: {
    OrdenTrabajo: 'Obra',
    EtapaOrden: 'Etapa',
    Deposito: 'Depósito',
    VersionPresupuesto: 'Adicional',
    PlantillaOrden: 'Modelo',
  },
  icons: {},
  access: {
    entities: ['OrdenTrabajo', 'Deposito'],
    permissions: [
      'ordenes.ver', 'ordenes.editar', 'ordenes.ver_margen', 'ordenes.aprobar_presupuesto',
      'ordenes.cerrar', 'inventario.mover', 'horas.cargar', 'horas.aprobar',
    ],
  },
  variants: [
    { codigo: 'modulo_20_pies', etiqueta: 'Módulo de 20 pies', confirmado: false },
    { codigo: 'modulo_40_pies', etiqueta: 'Módulo de 40 pies', confirmado: false },
    { codigo: 'vivienda_base', etiqueta: 'Vivienda base', confirmado: false },
    { codigo: 'oficina_base', etiqueta: 'Oficina base', confirmado: false },
  ],
  seedParameters: [
    { clave: 'vigencia_oferta_dias', descripcion: 'Días durante los que una oferta conserva vigencia.', valor: 7, unidad: 'dia', seguro: false, confirmado: false },
    { clave: 'frecuencia_revision_precios_dias', descripcion: 'Frecuencia para revisar los precios presupuestados.', valor: 30, unidad: 'dia', seguro: false, confirmado: false },
    { clave: 'umbral_desvio_margen_pp', descripcion: 'Desvío de margen, en puntos porcentuales, que requiere revisión.', seguro: false, confirmado: false },
    { clave: 'umbral_desvio_horas_pct', descripcion: 'Desvío porcentual de horas que requiere revisión.', unidad: '%', seguro: false, confirmado: false },
    { clave: 'dias_max_carga_horas', descripcion: 'Días máximos para cargar las horas trabajadas.', valor: 1, unidad: 'dia', seguro: false, confirmado: false },
    { clave: 'umbral_merma_normal_pct', descripcion: 'Porcentaje de merma considerado normal.', valor: 0, unidad: '%', seguro: false, confirmado: false },
    {
      clave: 'deposito_propio', descripcion: '¿Tenés depósito propio de materiales?', tipo: 'texto', confirmado: false,
      opciones: [{ valor: 'si', etiqueta: 'Sí' }, { valor: 'no', etiqueta: 'No' }],
      propuestaModulo: { valores: ['si'], clave: 'inventario' },
    },
    {
      clave: 'montaje_en_destino', descripcion: '¿El montaje en destino lo hace tu gente o lo tercerizás?', tipo: 'texto', confirmado: false,
      opciones: [{ valor: 'propio', etiqueta: 'Lo hace mi equipo' }, { valor: 'tercerizado', etiqueta: 'Lo tercerizo' }],
      propuestaModulo: { valores: ['propio'], clave: 'montaje-propio' },
    },
    {
      clave: 'usa_modelos_estandar', descripcion: '¿Trabajás con modelos estándar además de proyectos a medida?', tipo: 'texto', confirmado: false,
      opciones: [{ valor: 'si', etiqueta: 'Sí' }, { valor: 'no', etiqueta: 'No' }],
      propuestaModulo: { valores: ['si'], clave: 'plantillas' },
    },
    {
      clave: 'obras_mayores_un_mes', descripcion: '¿Tus obras duran más de un mes?', tipo: 'texto', confirmado: false,
      opciones: [{ valor: 'si', etiqueta: 'Sí' }, { valor: 'no', etiqueta: 'No' }],
      aviso: 'Las obras pueden atravesar varios períodos.',
    },
    {
      clave: 'base_pool_fabril', descripcion: '¿Cómo repartís hoy los gastos del taller?', tipo: 'texto', confirmado: false,
      opciones: [
        { valor: 'horas_mano_obra', etiqueta: 'Horas de mano de obra' },
        { valor: 'horas_maquina', etiqueta: 'Horas de máquina' },
        { valor: 'otra', etiqueta: 'Otra base' },
      ],
      hipotesis: true,
    },
  ],
  alertRules: [],
  screens: {
    home: {
      kpis: [
        { clave: 'margen_real_vs_presupuestado', etiqueta: 'Margen real vs. presupuestado de obras activas', confirmado: false },
        { clave: 'costo_vs_presupuesto', etiqueta: 'Costo comprometido e incurrido vs. presupuesto', confirmado: false },
        { clave: 'obras_con_desvio', etiqueta: 'Obras con desvío sobre el umbral', confirmado: false },
      ],
    },
    etapasPorDefecto: [
      { clave: 'metalurgica', etiqueta: 'Metalúrgica', entrega: false },
      { clave: 'aislacion_paneleria', etiqueta: 'Aislación y panelería', entrega: false },
      { clave: 'aberturas', etiqueta: 'Aberturas', entrega: false },
      { clave: 'instalaciones', etiqueta: 'Instalaciones eléctricas y sanitarias', entrega: false },
      { clave: 'terminaciones', etiqueta: 'Terminaciones', entrega: false },
      { clave: 'transporte_logistica', etiqueta: 'Transporte y logística', entrega: true },
      { clave: 'montaje_destino', etiqueta: 'Montaje e instalación en destino', entrega: true },
    ],
    // El núcleo agrega dólar e IPC. No se declara un índice sectorial sin una API verificada.
    indicadoresMacro: [],
  },
  modulos: [
    {
      clave: 'inventario', nombre: 'Inventario', descripcion: 'Controlá materiales en depósito.',
      superficies: [], destinos: {}, parametros: [], alertas: [], dependeDe: [], activoPorDefecto: true,
    },
    {
      clave: 'montaje-propio', nombre: 'Montaje propio', descripcion: 'Registrá horas en destino y viáticos.',
      superficies: [], destinos: {}, parametros: [], alertas: [], dependeDe: [], activoPorDefecto: false,
    },
    {
      clave: 'plantillas', nombre: 'Modelos', descripcion: 'Reutilizá modelos estándar en nuevas obras.',
      superficies: [], destinos: {}, parametros: [], alertas: [], dependeDe: [], activoPorDefecto: false,
    },
    {
      clave: 'configuracion-obras', nombre: 'Configuración de obras', descripcion: 'Completá las hipótesis iniciales del paquete.',
      superficies: [], destinos: {}, parametros: [
        'vigencia_oferta_dias', 'frecuencia_revision_precios_dias', 'umbral_desvio_margen_pp',
        'umbral_desvio_horas_pct', 'dias_max_carga_horas', 'umbral_merma_normal_pct',
        'deposito_propio', 'montaje_en_destino', 'usa_modelos_estandar',
        'obras_mayores_un_mes', 'base_pool_fabril',
      ], alertas: [], dependeDe: [], activoPorDefecto: true,
    },
  ],
} as const;
