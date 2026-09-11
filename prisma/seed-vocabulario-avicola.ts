// Seed del vocabulario avícola — 68 términos extraídos de las reuniones 001.2.42-48.
// Uso: tsx --env-file=.env prisma/seed-vocabulario-avicola.ts
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

export const CATEGORY = 'AVICULTURA';

/**
 * Filas que este seed retiró porque pertenecen al vocabulario de un tenant.
 * Se conservan los IDs, no los términos: permiten limpiar instalaciones ya
 * sembradas sin volver a publicar los datos que motivaron la retirada.
 */
export const EXTERNAL_IDS_RETIRADOS = [
  'AV-061', 'AV-062', 'AV-063', 'AV-064', 'AV-065', 'AV-067', 'AV-068',
] as const;

/**
 * Huellas SHA-256 de identificadores de tenant retirados (localidades,
 * proveedores y cifras de escala). La guarda compara valores normalizados sin
 * volver a escribir esos datos protegidos en este repositorio público.
 */
export const HUELLAS_DE_DATOS_TENANT = new Set([
  'c2ecd9101c080f49b49916b747cb6799a26b7c1af08ef8ffe45481628b2256d1',
  '37f4bdebcc3a6bbc41ddf09c5ac8c8333e1fe436fadb1443adb7b1078ede2fd9',
  'c64d48e6959c3c78388da7d007e257555f32fe2bc3c972bc02dd353df3460211',
  'bcf7bc6f1c2e0882f2f54f25383b3d61be674208dddf26e7a4d381ac497a0dac',
  '6ac9c8bc63aa103311302e94622292f5c6a02c59496a1880350b17bb58446a60',
  'f139cd12c6695c7d2537dfbbec297049500168757eccec1a51c956f9aab3c96e',
  '37f99ccfcb9b1cf21f65da6d37e86e80870a17982fe87321171505e37e2c8d51',
  'a176eeb31e601c3877c87c2843a2f584968975269e369d5c86788b4c2f92d2a2',
  '81a83544cf93c245178cbc1620030f1123f435af867c79d87135983c52ab39d9',
  '5a0b83e19c5750eed6d8d46cb858d15c956a657093c08afa53133c0fbe5f04fb',
  'cb0b20f98ee49533666fadc53dd6702a19d66e14ea2bb2bdc2474e305e40ada3',
] as const);

export const terminos = [
  {
    externalId: 'AV-001', termino: 'cajón', variantes: ['cajón de huevo', 'cajones'],
    concepto: 'Unidad de gestión del negocio avícola: 360 huevos = 12 maples de 30.',
    entidadDominio: 'ParametroCosteo.huevos_por_cajon · unidad de medida del tenant',
    seccion: 'VENTAS', yaEnPerfil: false, ambiguo: true,
    desambiguacion: 'CRÍTICO. Fuera de avícola "cajón" es un envase genérico o una caja de cartón. Acá es una UNIDAD DE CUENTA, no un objeto físico.',
    cita: 'Todo se expresa en cajones de huevo (360 unidades) — 001.2.46',
  },
  {
    externalId: 'AV-002', termino: 'maple', variantes: ['maples', 'huevera'],
    concepto: 'Bandeja de pulpa moldeada para 30 huevos. 12 maples = 1 cajón.',
    entidadDominio: 'ParametroCosteo.costo_maple · ParametroCosteo.maples_por_cajon',
    seccion: 'MATERIA_PRIMA', yaEnPerfil: true, ambiguo: false,
    desambiguacion: 'El perfil ya lo tiene en mpKeywords con pregunta doctrinaria abierta declarada.',
    cita: 'Maple: ~$200 por unidad de consumo real. Se compra en paquetes de 120 — 001.2.46',
  },
  {
    externalId: 'AV-003', termino: 'bachada', variantes: ['bachadas'],
    concepto: 'Lote de mezcla de alimento balanceado producido en una única corrida.',
    entidadDominio: 'Bachada — unidad de producción de una planta de alimento',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Regionalismo del NOA. En castellano técnico general equivale a "batch" o "partida de mezcla".',
    cita: 'Definición técnica del rubro.',
  },
  {
    externalId: 'AV-004', termino: 'estiba', variantes: ['estiva', 'estiba de harina'],
    concepto: 'Tiempo/forma de almacenamiento del alimento ya elaborado. Máximo recomendado 2 semanas: la harina decanta por densidad y hay que volver a mezclarla.',
    entidadDominio: 'ParametroCosteo.dias_max_estiba · ReglaAlerta "estiba vencida" (§10)',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: false, ambiguo: true,
    desambiguacion: 'OJO ORTOGRÁFICO: la fuente escribe "estiva" con v; el plan escribe "estiba" con b. Ambas circulan en el rubro. Cargar LAS DOS o el término no matchea. Fuera de avícola, "estiba" es la carga/descarga portuaria.',
    cita: 'Estiva máxima recomendada: 2 semanas — 001.2.46',
  },
  {
    externalId: 'AV-005', termino: 'pizarra', variantes: ['precio pizarra', 'pizarra Rosario'],
    concepto: 'Precio de referencia diario del grano publicado por la Bolsa de Rosario. Base para valuar maíz y expeller.',
    entidadDominio: 'LoteMateriaPrima.precio_unitario (referencia) · integración de precios',
    seccion: 'MATERIA_PRIMA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: 'Fuera del agro, "pizarra" es un material de construcción o un tablero. Acá es SIEMPRE un precio de mercado.',
    cita: 'Referencia de mercado: pizarra Rosario menos el flete hasta Rosario — 001.2.46',
  },
  {
    externalId: 'AV-006', termino: 'expeller', variantes: ['expeller de soja', 'expeler'],
    concepto: 'Subproducto sólido de la extracción de aceite de soja. Aporte proteico de la fórmula. 8-9 % de humedad residual.',
    entidadDominio: 'Insumo (tipo: proteico) · Formula.componentes',
    seccion: 'MATERIA_PRIMA', yaEnPerfil: true, ambiguo: false,
    desambiguacion: 'Ya en mpKeywords del perfil AVICULTURA.',
    cita: 'Expeller de soja: históricamente cotizaba pizarra +10%, hoy cotiza pizarra −20% — 001.2.46',
  },
  {
    externalId: 'AV-007', termino: 'conchilla', variantes: ['cáscara de ostra'],
    concepto: 'Fuente de calcio que se convierte literalmente en la cáscara del huevo. Se suplementa de noche, a partir de la semana 35.',
    entidadDominio: 'Insumo (tipo: micronutriente) · Formula.componentes',
    seccion: 'MATERIA_PRIMA', yaEnPerfil: true, ambiguo: false,
    desambiguacion: 'Ya en mpKeywords.',
    cita: 'Suplementación de calcio (carbonato / conchilla) de noche — 001.2.46',
  },
  {
    externalId: 'AV-008', termino: 'marlo', variantes: ['marlo de maíz'],
    concepto: 'Raquis de la espiga de maíz (el "tronco" sin granos). Fibra de bajo valor nutricional; su presencia baja la calidad del maíz comprado.',
    entidadDominio: 'LoteMateriaPrima — atributo de calidad',
    seccion: 'MATERIA_PRIMA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Regionalismo agrícola. Sin él, un remito que descuenta por marlo no se interpreta.',
    cita: 'Regionalismo identificado en §12 del plan',
  },
  {
    externalId: 'AV-009', termino: 'canjilón', variantes: ['canjilones'],
    concepto: 'Cangilón: recipiente de la noria/elevador que transporta grano dentro de la planta.',
    entidadDominio: 'Silo · equipamiento de planta (CIP)',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Aparece en facturas de mantenimiento de la planta. Es CIP, no MP.',
    cita: 'Regionalismo identificado en §12 del plan',
  },
  {
    externalId: 'AV-010', termino: 'postura', variantes: ['tasa de postura', '% de postura', 'porcentaje de postura'],
    concepto: 'Huevos puestos ÷ aves vivas × 100. Puede medirse por lote o por plantel.',
    entidadDominio: 'ProduccionDiaria → derivada · fórmula §8.1',
    seccion: 'NO_APLICA', yaEnPerfil: true, ambiguo: true,
    desambiguacion: '"Postura" sin calificar no distingue entre la métrica por lote y la de plantel.',
    cita: 'Definición productiva del rubro.',
  },
  {
    externalId: 'AV-011', termino: 'blanca', variantes: ['gallina blanca', 'huevo blanco', 'Highline White'],
    concepto: 'Raza de ponedora de huevo blanco. Entra 25 % más por jaula que la colorada; el huevo cuesta menos producir.',
    entidadDominio: 'Lote.raza (enum HighlineWhite) · Galpon.capacidad_blancas',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '"Blanca" y "colorada" solas son adjetivos de color en cualquier otro contexto. En avícola son RAZAS.',
    cita: 'El galpón admite 4.800 coloradas o hasta 6.300-6.400 blancas — 001.2.46',
  },
  {
    externalId: 'AV-012', termino: 'colorada', variantes: ['gallina colorada', 'huevo colorado', 'Highline Brown'],
    concepto: 'Raza de ponedora de huevo colorado. Menor densidad por jaula.',
    entidadDominio: 'Lote.raza (enum HighlineBrown) · Galpon.capacidad_coloradas',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: 'Ver AV-011.',
    cita: '001.2.46',
  },
  {
    externalId: 'AV-013', termino: 'faena', variantes: ['faenar', 'umbral de faena'],
    concepto: 'Fin del ciclo productivo de un lote de aves.',
    entidadDominio: 'Lote.estado (en_faena) · BajaAve.motivo (faena) · ReglaAlerta "umbral de faena"',
    seccion: 'NO_APLICA', yaEnPerfil: true, ambiguo: true,
    desambiguacion: '⚠️ COLISIÓN YA RESUELTA EN CÓDIGO: "faena" está en AVICOLA_NO_RE, que EXCLUYE del rubro a frigoríficos y mataderos. Un documento de la avícola que diga "faena" no debe reclasificar la empresa. La exclusión aplica a la DESCRIPCIÓN de la empresa, no al contenido de sus comprobantes.',
    cita: 'Definición productiva del rubro.',
  },
  {
    externalId: 'AV-014', termino: 'replume', variantes: ['repluma', 'muda forzada'],
    concepto: 'Muda inducida para extender el ciclo productivo del lote. Técnicamente posible pero hoy no rentable.',
    entidadDominio: 'Lote.estado · decisión de recambio',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Término exclusivo del rubro.',
    cita: 'El replume es técnicamente posible pero no rentable en la práctica actual — 001.2.46',
  },
  {
    externalId: 'AV-015', termino: 'despique', variantes: ['despicado'],
    concepto: 'Corte parcial del pico para evitar canibalismo en jaula.',
    entidadDominio: 'Servicio sanitario del plantel → CIP',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Es un servicio sobre el plantel, no un insumo del huevo → CIP por R7.',
    cita: 'Regionalismo identificado en §12 del plan',
  },
  {
    externalId: 'AV-016', termino: 'recambio de lote', variantes: ['recambio', 'reposición de plantel'],
    concepto: 'Sustitución del lote agotado por pollitas nuevas. Ciclo ~2 años desde el nacimiento.',
    entidadDominio: 'Lote.vida_util_meses · ParametroCosteo.vida_util_lote_meses',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: '⚠️ CONFLICTO DE DATO: 001.2.43 dice vida productiva ~18 meses; 001.2.46 dice ciclo ~2 años; el plan usa default 24 meses. Hay que cerrarlo con el cliente.',
    cita: 'Ciclo productivo de ~2 años desde el nacimiento hasta la faena — 001.2.46',
  },
  {
    externalId: 'AV-017', termino: 'huevo por ave alojada', variantes: ['rendimiento por lote'],
    concepto: 'Σ huevos del ciclo ÷ aves ingresadas. Indicador de ciclo completo (~24 meses), NO mensual.',
    entidadDominio: 'Derivada de Lote + ProduccionDiaria · fórmula §8.1',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'El cliente lo nombra como el dato que hoy NO tiene y más quiere.',
    cita: 'Historial de rendimiento por lote (huevo por ave alojada) — 001.2.46',
  },
  {
    externalId: 'AV-018', termino: 'coima', variantes: [],
    concepto: 'Sobreprecio en efectivo por compra sin factura: ~5 $/kg sobre el maíz.',
    entidadDominio: 'LoteMateriaPrima.en_negro (bool) + sobreprecio',
    seccion: 'MATERIA_PRIMA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '⚠️ SENSIBLE. Es un costo real que el cliente declara verbalmente pero sin respaldo documental. Decisión de producto: si se registra, cómo se muestra y quién lo ve. NO clasificar automáticamente sin decisión del equipo.',
    cita: 'Compras en negro: se suman ~5 $/kg de coima al precio — 001.2.46',
  },
  {
    externalId: 'AV-019', termino: 'spot', variantes: ['precio spot', 'mercado spot'],
    concepto: 'Precio de mercado del momento, por oposición al precio "techo" que el cliente usa para presupuestar.',
    entidadDominio: 'Referencia de valuación',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: 'Anglicismo financiero; fuera del agro tiene otros sentidos (publicidad, iluminación).',
    cita: 'sin depender del spot — 001.2.46',
  },
  {
    externalId: 'AV-020', termino: 'techo de costeo', variantes: ['precio techo', 'costear por arriba'],
    concepto: 'Criterio conservador del cliente: valuar el insumo al precio más alto para cubrirse ante subas.',
    entidadDominio: 'Criterio de valuación configurable — NO es el PPP del motor',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '⚠️ CHOCA CON EL MOTOR. CosteAR valúa por PPP. El cliente valúa por precio de reposición "con techo". Decisión pendiente, no se resuelve con vocabulario.',
    cita: 'siempre usar el techo más alto para cubrirse ante subas — 001.2.46',
  },
  {
    externalId: 'AV-021', termino: 'caja gruesa', variantes: [],
    concepto: 'La unidad de negocio de mayor volumen de caja (granos), la que exige el seguimiento más riguroso.',
    entidadDominio: 'Unidad de negocio — FUERA de Fase 1',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: 'Modismo. No es una caja física ni la caja contable: es "donde está la plata grande".',
    cita: 'La unidad de granos es "la caja gruesa" — 001.2.46',
  },
  {
    externalId: 'AV-022', termino: 'punto de quiebre del lote', variantes: ['punto de quiebre'],
    concepto: 'Rinde mínimo por hectárea que hace rentable el lote de maíz: 4.000 kg/ha.',
    entidadDominio: 'FUERA de Fase 1 (granos)',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '⚠️ COLISIÓN INTERNA GRAVE: "punto de quiebre" acá NO es el punto de equilibrio del negocio avícola. Es un umbral de rinde agrícola. Y "lote" acá es una parcela de tierra.',
    cita: 'Punto de quiebre del lote de maíz: 4.000 kg/ha — 001.2.46',
  },
  {
    externalId: 'AV-023', termino: 'lote', variantes: ['lotes'],
    concepto: 'En granja: conjunto de aves de la misma edad y raza. En granos: parcela de tierra sembrada.',
    entidadDominio: 'Lote (§7.1) — granja',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '⚠️ COLISIÓN DENTRO DEL MISMO CLIENTE. El cliente usa "lote" para las dos cosas. También existe "lote de materia prima" (§7.2). Tres sentidos distintos.',
    cita: '001.2.46 — usa ambos sentidos',
  },
  {
    externalId: 'AV-024', termino: 'galpón', variantes: ['galpones', 'galponero'],
    concepto: 'Nave de producción donde se alojan las ponedoras. Capacidad según raza.',
    entidadDominio: 'Galpon (§7.1)',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: true, ambiguo: false,
    desambiguacion: 'El perfil ya tiene "mantenimiento de galpones", "operario de galpón", "cama de galpón".',
    cita: '001.2.46',
  },
  {
    externalId: 'AV-025', termino: 'silo', variantes: ['silos'],
    concepto: 'Depósito de materia prima a granel. Hoy el nivel se mide A OJO: un golpe con una tuerca desde afuera, sin sensor.',
    entidadDominio: 'Silo (§7.2) · ReglaAlerta "silo bajo" (§10)',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Es el mayor riesgo operativo declarado por el cliente.',
    cita: 'El nivel de los silos se mide a ojo — 001.2.46',
  },
  {
    externalId: 'AV-026', termino: 'descarte', variantes: ['huevo descartado', 'huevo no comercial'],
    concepto: 'Huevo que no entra en ninguna categoría comercial.',
    entidadDominio: 'ProduccionDiaria.desglose[tamaño=descarte]',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: true, ambiguo: true,
    desambiguacion: '⚠️ "huevo descartado" ya está en lossKeywords (merma). Pero "gallina de descarte" está DELIBERADAMENTE FUERA: no es merma sino fin planificado del ciclo.',
    cita: 'industry-profile.ts:186-195 y :324-326',
  },
  {
    externalId: 'AV-027', termino: 'gallina de descarte', variantes: ['gallina al final del ciclo'],
    concepto: 'Ave que termina su ciclo productivo y se vende. NO es merma: es el fin planificado del ciclo del activo.',
    entidadDominio: 'Venta · recupero del costo del plantel (subproducto Categoría 1 o 2)',
    seccion: 'VENTAS', yaEnPerfil: false, ambiguo: true,
    desambiguacion: 'AUSENCIA DELIBERADA en el perfil. CostSection no tiene sección de "recupero/reducción del costo de producción", así que el tratamiento Categoría 2 de la cátedra NO es representable hoy.',
    cita: 'industry-profile.ts:186-195 · corpus ME-03',
  },
  {
    externalId: 'AV-028', termino: 'mortandad', variantes: ['mortalidad del plantel', 'gallinas muertas'],
    concepto: 'Bajas del plantel. Normal declarada del período: 5,5 %. Extraordinaria: brote sanitario o golpe de calor.',
    entidadDominio: 'BajaAve.motivo (mortalidad) · ParametroCosteo.tolerancia_mortandad_pct (PROPUESTO)',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: true, ambiguo: true,
    desambiguacion: 'El perfil la trata como merma AMBIGUA → revisión humana obligatoria. El umbral normal/extraordinario NO está en el texto del comprobante.',
    cita: 'Mortalidad normal del período: 5,5% — 001.2.46',
  },
  {
    externalId: 'AV-029', termino: 'golpe de calor', variantes: ['estrés térmico', 'ola de calor'],
    concepto: 'Evento térmico que mata plantel. La gallina no transpira: regula por la boca. Confort 24 °C; riesgo real a 37-38 °C.',
    entidadDominio: 'Evento → merma extraordinaria · ReglaAlerta',
    seccion: 'NO_APLICA', yaEnPerfil: true, ambiguo: false,
    desambiguacion: 'Ya en eventKeywords del perfil.',
    cita: '001.2.46',
  },
  {
    externalId: 'AV-030', termino: 'premezcla', variantes: ['núcleo', 'concentrado', 'corrector vitamínico'],
    concepto: 'Micronutrientes de la fórmula. El insumo más caro por kilo pero solo 2 % del alimento.',
    entidadDominio: 'Insumo (tipo: micronutriente) · Formula.componentes',
    seccion: 'MATERIA_PRIMA', yaEnPerfil: true, ambiguo: false,
    desambiguacion: 'Ya en mpKeywords.',
    cita: 'Concentrados (micronutrientes): el insumo más caro por kilo, 2% del alimento — 001.2.46',
  },
  {
    externalId: 'AV-031', termino: 'pellet de girasol', variantes: ['pellet'],
    concepto: 'Aporte de fibra de la fórmula. Se pide cada ~4 meses.',
    entidadDominio: 'Insumo (tipo: fibra) · Formula.componentes',
    seccion: 'MATERIA_PRIMA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '"Pellet" solo es genérico (puede ser madera, plástico). Cargar la forma compuesta.',
    cita: 'Pellet de girasol | Fibra — 001.2.46',
  },
  {
    externalId: 'AV-032', termino: 'humedad', variantes: ['% de humedad', 'grano húmedo'],
    concepto: 'Contenido de agua del grano. Maíz con más de 16 % no se puede almacenar: fermenta y se pierde el lote entero.',
    entidadDominio: 'LoteMateriaPrima.humedad_pct · Insumo.humedad_max_admisible · ReglaAlerta "maíz húmedo"',
    seccion: 'MATERIA_PRIMA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Umbral dado por el cliente (16 %), no propuesto por el equipo.',
    cita: 'maíz con más de 16% de humedad no se puede almacenar — 001.2.46',
  },
  {
    externalId: 'AV-033', termino: 'desvío de consumo', variantes: ['sobreconsumo', 'consumo desviado'],
    concepto: '(consumo real − consumo teórico) / consumo teórico. Detecta sobreconsumo, robo o error de carga.',
    entidadDominio: 'Fórmula §8.2 desvio_consumo_pct · ReglaAlerta',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Método real de detección del cliente: calculó alimento para 7 días y el operario lo pedía cada 10.',
    cita: '§8.2 del plan',
  },
  {
    externalId: 'AV-034', termino: 'gramaje', variantes: ['gramos por ave', 'g/ave/día'],
    concepto: 'Consumo estándar de alimento por ave por día. El valor concreto se carga como parámetro de costeo, no se asume.',
    entidadDominio: 'ParametroCosteo.gramaje_estandar_gr · TablaEstandarPeso',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Varía por raza y semana de vida.',
    cita: '6.300 gallinas × 120g/día — 001.2.43',
  },
  {
    externalId: 'AV-035', termino: 'uniformidad', variantes: ['% de uniformidad'],
    concepto: 'Aves dentro de ±10 % del peso promedio ÷ aves muestreadas. Se mide sobre 20 jaulas cada 15 días.',
    entidadDominio: 'MuestreoPeso.uniformidad_pct',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Dato hoy no sistematizado.',
    cita: 'Peso de gallinas por muestreo de 20 jaulas cada 15 días — 001.2.46',
  },
  {
    externalId: 'AV-036', termino: 'jaula', variantes: ['jaulas', 'nidal'],
    concepto: 'Unidad de alojamiento. Determina la capacidad del galpón por raza.',
    entidadDominio: 'Galpon.capacidad_* · equipamiento (CIP)',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: true, ambiguo: false,
    desambiguacion: 'Ya en cipKeywords.',
    cita: '001.2.46',
  },
  {
    externalId: 'AV-037', termino: 'pollita', variantes: ['pollitas', 'ave de reposición'],
    concepto: 'Ave joven que ingresa al galpón. Compra a ~USD 7 c/u a las 16 semanas; rompe postura en la semana 24.',
    entidadDominio: 'Lote.aves_ingresadas · Lote.costo_adquisicion_total',
    seccion: 'NO_APLICA', yaEnPerfil: true, ambiguo: true,
    desambiguacion: 'EXCLUIDA A PROPÓSITO de mpKeywords: el plantel es un ACTIVO amortizable, no un insumo del período.',
    cita: 'industry-profile.ts:234-236 · 001.2.43',
  },
  {
    externalId: 'AV-038', termino: 'amortización del plantel', variantes: ['amortización de gallinas', 'reposición de gallina'],
    concepto: '(costo del lote − valor residual) / vida útil en meses. Es la parte del costo que más se olvida reservar.',
    entidadDominio: 'Lote.vida_util_meses · fórmula §8.3 · CIP',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: true, ambiguo: true,
    desambiguacion: '⚠️ ERROR VERIFICADO: 001.2.46 dice "$800 por cabeza" y "6.300 ÷ 24 × $800 = ~$2,8M/mes". Esa cuenta da $210.000. El bueno es el $2,8M. Costo por ave implícito: $10.666,67. NO cargar $800.',
    cita: 'Contablemente no es una erogación mensual, pero es una previsión clave — 001.2.46',
  },
  {
    externalId: 'AV-039', termino: 'integración vertical', variantes: ['beneficio de integración'],
    concepto: 'Maíz propio consumido en la granja. Si producirlo costó $130/t y se transfiere a $180 (mercado), los $50 se contabilizan como beneficio de integración.',
    entidadDominio: 'Precio de transferencia — DECISIÓN PENDIENTE B.1 #1',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '⚠️ El cliente tiene criterio propio: transferir a precio de mercado. El plan sugiere lo contrario (a costo real). Contradicción a resolver con él.',
    cita: 'esos $50 de diferencia se pueden contabilizar como beneficio de integración — 001.2.46',
  },
  {
    externalId: 'AV-040', termino: 'cámara avícola', variantes: ['la cámara'],
    concepto: 'Asociación del sector, ~10 miembros, vía Martín de Zavalía. Canal de expansión del vertical.',
    entidadDominio: 'Comercial — fuera del modelo',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '"Cámara" colisiona con la cámara de video del módulo de IA y con cámara frigorífica.',
    cita: 'Anexo B.3 del plan',
  },
  {
    externalId: 'AV-041', termino: 'acopio', variantes: ['acopiador'],
    concepto: 'Depósito de terceros donde se liquida el grano (Bunge, AGD, Cargill).',
    entidadDominio: 'FUERA de Fase 1 (granos)',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Ya aparece en el corpus (MP-03: "desde acopio Leales hasta granja").',
    cita: '001.2.43',
  },
  {
    externalId: 'AV-042', termino: 'carta de porte', variantes: [],
    concepto: 'Documento de transporte de granos. Lo expone la plataforma AGD.',
    entidadDominio: 'FUERA de Fase 1 (granos)',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Documento fiscal específico del agro argentino.',
    cita: '001.2.46',
  },
  {
    externalId: 'AV-043', termino: 'cuenta corriente granaria', variantes: [],
    concepto: 'Estado de cuenta del productor en el acopio: toneladas entregadas, comprometidas y liquidadas.',
    entidadDominio: 'FUERA de Fase 1 (granos)',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: '—',
    cita: '001.2.46',
  },
  {
    externalId: 'AV-044', termino: 'liquidación de cereales', variantes: ['LPG', 'liquidación primaria de granos'],
    concepto: 'Comprobante de venta de grano con retenciones y descuentos.',
    entidadDominio: 'FUERA de Fase 1 (granos)',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'El plan lo excluye explícitamente de Fase 1 (§4).',
    cita: '001.2.43',
  },
  {
    externalId: 'AV-045', termino: 'retenciones', variantes: ['derechos de exportación'],
    concepto: 'Impuesto a la exportación de granos.',
    entidadDominio: 'FUERA de Fase 1 (granos)',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '"Retención" también es retención impositiva de IVA/Ganancias en cualquier factura. Sentidos distintos.',
    cita: '001.2.46',
  },
  {
    externalId: 'AV-046', termino: 'bolsa', variantes: ['bolsas de 40 kg'],
    concepto: 'Envase del alimento terminado: ~5 bolsas de 40 kg por bachada de 200 kg.',
    entidadDominio: 'Bachada.bolsas_producidas',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '"Bolsa" colisiona con Bolsa de Rosario. En una frase de compra de granos, "bolsa" puede ser el mercado.',
    cita: 'Salida en bolsas de ~40 kg, ~5 bolsas por bachada — 001.2.46',
  },
  {
    externalId: 'AV-047', termino: 'balanceado', variantes: ['alimento balanceado', 'ración'],
    concepto: 'Alimento terminado producido por la planta. La MP principal del negocio de postura (~70 % del costo).',
    entidadDominio: 'Bachada (salida) · costo_kg_alimento',
    seccion: 'MATERIA_PRIMA', yaEnPerfil: true, ambiguo: true,
    desambiguacion: '⚠️ NOTA: "ración" se sacó del perfil porque el match era por substring y matcheaba "repa-ración". La causa ya no existe pero se dejó afuera por redundante.',
    cita: 'industry-profile.ts:203-211 · El 70% del costo es el alimento — 001.2.43',
  },
  {
    externalId: 'AV-048', termino: 'fórmula', variantes: ['fórmulas', 'receta'],
    concepto: 'Composición del alimento por especie y etapa productiva. Varía por especie y edad. Múltiples fórmulas activas en simultáneo.',
    entidadDominio: 'Formula (§7.2) — CONFIDENCIAL, ver §13',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '⚠️ Colisiona con "fórmula" de cálculo en el propio CosteAR. Y es el activo de propiedad intelectual que motiva la objeción de seguridad del cliente.',
    cita: 'La fórmula no es fija: varía por especie y por edad del animal — 001.2.46',
  },
  {
    externalId: 'AV-049', termino: 'tamaño', variantes: ['calibre', 'N°1', 'N°2', 'N°3', 'jumbo'],
    concepto: 'Categoría comercial del huevo. Coproductos del mismo proceso con precios distintos.',
    entidadDominio: 'ProduccionDiaria.desglose · StockHuevo.tamaño · JointProduct del motor',
    seccion: 'VENTAS', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '⚠️ CONFLICTO DE DATO: 001.2.43 dice 5 tipos (Jumbo, 1-4); el plan define 4 + descarte; 001.2.46 menciona N°1,2,3. Hay que cerrar cuántas categorías son.',
    cita: 'Huevo clasificado en 5 tipos (Jumbo, 1-4) — 001.2.43',
  },
  {
    externalId: 'AV-050', termino: 'clasificadora', variantes: ['sala de clasificación'],
    concepto: 'Máquina que separa el huevo por tamaño. Es el PUNTO DE SEPARACIÓN de los costos conjuntos.',
    entidadDominio: 'Punto de separación (§6.1) · primer caso de uso del simulador',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Define dónde termina el costo conjunto y empiezan los costos específicos por tamaño.',
    cita: 'La clasificadora de 6 M que reemplaza 3 personas — Anexo B.2 #9 del plan',
  },
  {
    externalId: 'AV-051', termino: '3 pasadas', variantes: ['pasada de alimentación'],
    concepto: 'Régimen de alimentación diario. En verano se alimenta de madrugada (1-2 AM) para evitar el golpe de calor.',
    entidadDominio: 'Operativo — afecta el registro de consumo',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Relevante para interpretar cargas nocturnas del bot: un registro a las 2 AM no es un error.',
    cita: 'Alimentación en 3 pasadas diarias — 001.2.46',
  },
  {
    externalId: 'AV-052', termino: 'comedero', variantes: ['bebedero', 'cinta de recolección'],
    concepto: 'Equipamiento del galpón.',
    entidadDominio: 'CIP — mantenimiento',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: true, ambiguo: false,
    desambiguacion: 'Ya en cipKeywords.',
    cita: 'industry-profile.ts:264-265',
  },
  {
    externalId: 'AV-053', termino: 'grupo electrógeno', variantes: ['generador'],
    concepto: 'Respaldo eléctrico. Sin ventilación forzada el galpón se muere en horas.',
    entidadDominio: 'CIP — su gasoil es fuerza motriz, NO materia prima',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: true, ambiguo: true,
    desambiguacion: '⚠️ ESTE es el defecto CIP-02 que el perfil AVICULTURA vino a corregir: bajo AGRO, fuelIsMP: true mandaba su gasoil a MATERIA PRIMA con confianza 97.',
    cita: 'industry-profile.ts:171-172, 329-330',
  },
  {
    externalId: 'AV-054', termino: 'brote', variantes: ['brote sanitario', 'brote de newcastle', 'gripe aviar'],
    concepto: 'Evento sanitario que causa mortandad masiva → pérdida extraordinaria del período.',
    entidadDominio: 'Evento · intent PERDIDA_INVENTARIO',
    seccion: 'NO_APLICA', yaEnPerfil: true, ambiguo: true,
    desambiguacion: 'El perfil lo nombra como BROTE y no por el patógeno suelto a propósito.',
    cita: 'industry-profile.ts:294-299 · corpus ME-02',
  },
  {
    externalId: 'AV-055', termino: 'bioseguridad', variantes: ['sanidad', 'desinfección'],
    concepto: 'Protocolo sanitario del establecimiento.',
    entidadDominio: 'CIP — material indirecto',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: true, ambiguo: false,
    desambiguacion: 'Ya en cipKeywords.',
    cita: 'industry-profile.ts:255',
  },
  {
    externalId: 'AV-056', termino: 'cama de galpón', variantes: ['viruta', 'cascarilla de arroz'],
    concepto: 'Material de piso del galpón.',
    entidadDominio: 'CIP',
    seccion: 'COSTOS_INDIRECTOS', yaEnPerfil: true, ambiguo: false,
    desambiguacion: 'Ya en cipKeywords.',
    cita: 'industry-profile.ts:267',
  },
  {
    externalId: 'AV-057', termino: 'capacidad instalada', variantes: ['capacidad real operativa'],
    concepto: 'Máximo de producción teórico de una instalación, distinguible de su capacidad real operativa.',
    entidadDominio: 'Capacidad normal del centro (CIP)',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: 'Distinguir capacidad por bachada, ritmo horario y jornada antes de calcular el uso.',
    cita: 'Definición operativa del rubro.',
  },
  {
    externalId: 'AV-058', termino: 'contador de bachadas', variantes: ['contador de la máquina'],
    concepto: 'La máquina acumula kilos totales pero sin desglose por tipo de alimento ni por período.',
    entidadDominio: 'Fuente de datos — canal de ingesta (§9)',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Contradicción menor: el plan §9 dice que sí informa bachadas por fórmula; 001.2.46 dice que NO desglosa por tipo.',
    cita: 'sin desglose por tipo de alimento ni por período — 001.2.46',
  },
  {
    externalId: 'AV-059', termino: 'punto de equilibrio', variantes: ['PE', 'equilibrio'],
    concepto: 'Nivel de actividad o ventas que cubre los costos fijos del período.',
    entidadDominio: 'Fórmula §8.3 — debe recalcularse ante cada cambio de precio',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '⚠️ No confundir con AV-022 "punto de quiebre del lote", que es un umbral de rinde agrícola.',
    cita: 'Definición de costos.',
  },
  {
    externalId: 'AV-060', termino: 'presupuestado vs real', variantes: ['variación presupuestaria'],
    concepto: 'Comparación entre el presupuesto y la ejecución para identificar desvíos.',
    entidadDominio: 'Ya existe en el núcleo (comparación de períodos)',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: false,
    desambiguacion: 'Los desvíos requieren contexto operativo antes de atribuir una causa.',
    cita: 'Definición de control presupuestario.',
  },
  {
    externalId: 'AV-066', termino: 'IVA a favor', variantes: ['saldo técnico'],
    concepto: 'Crédito fiscal acumulado que puede surgir al comparar débitos y créditos de IVA.',
    entidadDominio: 'Fuera del costeo (R4: el IVA no es costo para RI)',
    seccion: 'NO_APLICA', yaEnPerfil: false, ambiguo: true,
    desambiguacion: '⚠️ NO debe entrar al costo. R4 del ground-truth: para RI el costeo corre sobre el neto.',
    cita: 'Criterio contable general.',
  },
];

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function huella(texto: string): string {
  return createHash('sha256').update(normalizar(texto)).digest('hex');
}

/** Evita reintroducir identificadores de tenant que ya fueron retirados. */
export function validarVocabularioPublico(
  entradas: readonly (typeof terminos)[number][],
  huellasProtegidas: ReadonlySet<string> = HUELLAS_DE_DATOS_TENANT,
): void {
  const valores = entradas.flatMap((entrada) => [
    entrada.externalId,
    entrada.termino,
    ...entrada.variantes,
    entrada.concepto,
    entrada.entidadDominio,
    entrada.seccion,
    entrada.desambiguacion,
    entrada.cita,
  ].filter((valor): valor is string => typeof valor === 'string'));
  const cifras = valores.flatMap((valor) => valor.match(/\b\d{1,3}(?:[.\s]\d{3})*\b/g) ?? []);

  if ([...valores, ...cifras].some((valor) => huellasProtegidas.has(huella(valor)))) {
    throw new Error('El seed contiene un identificador de tenant retirado.');
  }
}

export async function seedVocabularioAvicola(db: PrismaClient = prisma) {
  validarVocabularioPublico(terminos);
  console.log(`Seeding vocabulario avícola (${terminos.length} términos)…`);

  // El seed anterior ya pudo haber insertado estas filas. Limpiarlas por ID es
  // idempotente y evita que desaparezcan del código pero sobrevivan en la base.
  await db.vocabularioTermino.deleteMany({
    where: { industryCategory: CATEGORY, externalId: { in: [...EXTERNAL_IDS_RETIRADOS] } },
  });

  let upserted = 0;
  for (const t of terminos) {
    await db.vocabularioTermino.upsert({
      where: { industryCategory_termino: { industryCategory: CATEGORY, termino: t.termino } },
      update: { ...t, industryCategory: CATEGORY },
      create: { ...t, industryCategory: CATEGORY },
    });
    upserted++;
  }

  console.log(`Done. ${upserted} términos upserted para ${CATEGORY}.`);
}

if (process.argv[1]?.endsWith('seed-vocabulario-avicola.ts')) {
  seedVocabularioAvicola()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
