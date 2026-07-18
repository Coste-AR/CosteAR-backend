// src/infrastructure/classifier/industry/industry-profile.ts
import type { IndustryCategory, GastoSubtype } from '../types.js';

/**
 * Señales de GASTO (no-costo) TRANSVERSALES a todos los rubros.
 *
 * Criterio de la cátedra: solo los costos del área de producción (MP, MOD, CIP)
 * son "costo" inventariable y parte del costo unitario. Todo lo que nace en
 * comercialización, administración o el área financiera es "gasto" y NO debe
 * imputarse a Costos Indirectos de Producción (CIP): hacerlo infla la tasa de
 * prorrateo y sobrecostea la unidad.
 *
 * Estas señales son cross-industry (una comisión bancaria o los honorarios del
 * contador son gasto en cualquier rubro), por eso viven acá y no dentro de cada
 * perfil de industria. El routing (layer4) las puntea aparte de MP/MOD/CIP.
 */
export const TRANSVERSAL_GASTO_KEYWORDS: Record<GastoSubtype, string[]> = {
  // Comercialización: gasto de cara a la venta / marketing.
  GASTO_COMERCIALIZACION: [
    'publicidad', 'marketing', 'promoción', 'promocion', 'promociones',
    'comisión de venta', 'comision de venta', 'comisión por venta', 'comision por venta',
    'comisión sobre venta', 'comision sobre venta', 'comisión de vendedor', 'comision de vendedor',
    'viáticos vendedor', 'viaticos vendedor', 'viático vendedor', 'viatico vendedor',
    'viáticos de vendedores', 'viaticos de vendedores',
    'gastos de comercialización', 'gastos de comercializacion',
    'material publicitario', 'campaña publicitaria', 'campana publicitaria',
    'folletería', 'folleteria', 'volantes', 'cartelería', 'carteleria',
    'stand', 'feria comercial', 'exposición comercial', 'exposicion comercial',
    'redes sociales', 'community manager', 'google ads', 'facebook ads',
  ],
  // Administración: gasto de back-office / conducción de la empresa.
  GASTO_ADMINISTRACION: [
    'honorarios contador', 'honorarios contable', 'honorarios contables',
    'honorarios estudio', 'honorarios del estudio', 'honorarios estudio contable',
    'honorarios abogado', 'honorarios jurídicos', 'honorarios juridicos',
    'sueldo administración', 'sueldo administracion', 'sueldos administración', 'sueldos administracion',
    'sueldo administrativo', 'sueldos administrativos', 'personal administrativo',
    'sueldo gerente general', 'sueldo gerente', 'sueldos gerencia', 'honorarios directorio',
    'papelería oficina', 'papeleria oficina', 'papelería de oficina', 'papeleria de oficina',
    'útiles de oficina', 'utiles de oficina', 'útiles oficina', 'utiles oficina',
    'insumos de oficina', 'gastos administrativos', 'gastos de administración', 'gastos de administracion',
    // Tareas contables/impositivas: gasto de administración en cualquier rubro.
    'confección de balance', 'confeccion de balance', 'balance contable', 'balance impositivo',
    'liquidación de impuestos', 'liquidacion de impuestos', 'declaración jurada', 'declaracion jurada',
  ],
  // Financiero: costo de financiamiento / servicios bancarios.
  GASTO_FINANCIERO: [
    'gastos bancarios', 'gasto bancario', 'comisión bancaria', 'comision bancaria',
    'comisiones bancarias', 'comisión de mantenimiento de cuenta', 'comision de mantenimiento de cuenta',
    'gastos de mantenimiento de cuenta', 'mantenimiento de cuenta',
    'interés financiero', 'interes financiero', 'intereses financieros',
    'interés por mora', 'interes por mora', 'intereses moratorios', 'punitorios',
    'gastos financieros', 'sellado bancario', 'impuesto al cheque', 'impuesto a los débitos',
    'impuesto a los debitos', 'comisión tarjeta', 'comision tarjeta',
    'descuento de cheques', 'descubierto bancario', 'interés préstamo', 'interes prestamo',
  ],
};

export interface IndustryProfile {
  category: IndustryCategory;
  label: string;
  // Palabras que indican Materia Prima en este rubro
  mpKeywords: string[];
  // Palabras que indican Costos Indirectos de Producción
  cipKeywords: string[];
  // Palabras que indican Mano de Obra
  modKeywords: string[];
  // Palabras de EVENTO DE NEGOCIO típico del rubro
  eventKeywords: string[];
  // Palabras de PÉRDIDA DE INVENTARIO típica del rubro
  lossKeywords: string[];
  // Si la energía (gas, electricidad) es MP en este rubro
  energyIsMP: boolean;
  // Si el combustible es MP (tractores, maquinaria de producción directa)
  fuelIsMP: boolean;
}

// ── Definición de perfiles por rubro ─────────────────────────────────────────

const PROFILES: Record<IndustryCategory, IndustryProfile> = {
  AGRO: {
    category: 'AGRO',
    label: 'Agropecuario',
    mpKeywords: [
      'semilla', 'simiente', 'agroquímico', 'agroquimico', 'herbicida', 'fungicida',
      'insecticida', 'fertilizante', 'abono', 'inoculante', 'fosfato',
      'gasoil', 'combustible', 'nafta', 'lubricante',
      'forraje', 'alimento balanceado', 'pellet', 'silo',
      'veterinaria', 'vacuna', 'antiparasitario', 'medicamento animal',
      'bolsa', 'bolsón', 'arpillera', 'envase agrícola',
      'riego', 'goteo', 'aspersor',
      'soja', 'maíz', 'trigo', 'girasol', 'sorgo', 'algodón',
      'vid', 'uva', 'mosto', 'sulfato de cobre',
    ],
    cipKeywords: [
      'alquiler campo', 'arrendamiento', 'flete', 'transporte grano',
      'seguro agrícola', 'seguro granizo', 'seguro climático',
      'servicio de cosecha', 'contratista cosecha', 'trilla',
      'pulverización aérea', 'siembra directa servicio',
      'honorarios agrónomo', 'análisis suelo',
      'mantenimiento maquinaria', 'reparacion tractor', 'repuesto agrícola',
      'telefonía rural', 'internet rural', 'electricidad rural',
    ],
    modKeywords: [
      'jornada', 'peón rural', 'cosechador', 'tractorista',
      'mano de obra rural', 'contratación temporaria',
      'personal de campo', 'capataz',
    ],
    eventKeywords: [
      'sequía', 'sequia', 'lluvia', 'granizo', 'helada', 'tormenta',
      'inundación', 'inundacion', 'viento zonda', 'sudestada',
      'plaga', 'langosta', 'chinche', 'roya',
      'siembra tardía', 'no se pudo cosechar', 'pérdida de cosecha',
      'cosecha frustrada', 'no hubo producción', 'campo anegado',
    ],
    lossKeywords: [
      'pérdida de grano', 'merma', 'siniestro', 'daño climático',
      'grano húmedo', 'grano brotado', 'aflatoxina',
    ],
    energyIsMP: false,
    fuelIsMP: true, // combustible de tractores = insumo de producción
  },

  GASTRONOMIA: {
    category: 'GASTRONOMIA',
    label: 'Gastronomía / Alimentos',
    mpKeywords: [
      // Carnes
      'carne', 'pollo', 'cerdo', 'pescado', 'mariscos', 'vacuno', 'cordero',
      // Lácteos
      'leche', 'queso', 'manteca', 'crema', 'yogur', 'mantequilla',
      // Verduras y frutas
      'verdura', 'fruta', 'legumbre', 'papa', 'tomate', 'cebolla', 'lechuga',
      // Secos
      'harina', 'azúcar', 'azucar', 'arroz', 'fideos', 'pasta', 'sémola',
      'levadura', 'sal', 'aceite', 'vinagre',
      // Bebidas
      'vino', 'cerveza', 'gaseosa', 'agua mineral', 'jugo', 'bebida',
      // Insumos descartables de cocina (son MP en gastro)
      'descartable', 'vaso descartable', 'plato descartable', 'envase', 'film',
      // Gas de cocina (es insumo de producción en gastro)
      'gas envasado', 'garrafa', 'gas cocina',
      'condimento', 'especias', 'salsa', 'aderezo',
    ],
    cipKeywords: [
      'alquiler local', 'alquiler salón', 'expensas',
      'seguro', 'alarma', 'seguridad',
      'limpieza', 'desinfección', 'desinfeccion', 'fumigación',
      'bromatología', 'habilitación municipal',
      'electricidad', 'luz', 'agua potable',
      'internet', 'teléfono', 'telefono',
      'vajilla', 'menaje', 'cubertería', 'silla', 'mesa',
      'mantenimiento', 'reparación heladera', 'reparación horno',
    ],
    modKeywords: [
      'sueldo cocinero', 'sueldo mozo', 'sueldo personal',
      'liquidación', 'honorarios', 'personal gastronómico',
    ],
    eventKeywords: [
      'clausura', 'clausuraron', 'habilitación vencida', 'bromatología',
      'inspección', 'multa municipal', 'cierre temporario',
      'robo', 'hurto', 'entrada forzada',
      'incendio cocina', 'accidente cocina',
      'falta de luz', 'corte de gas',
    ],
    lossKeywords: [
      'se quemó', 'quemé', 'se perdió', 'se echó a perder', 'se venció',
      'merma', 'desperdicio', 'vencimiento', 'se pudrió',
      'rotura heladera', 'corte de frío',
    ],
    energyIsMP: false, // electricidad es CIP, gas de cocina es MP (ver mpKeywords)
    fuelIsMP: false,
  },

  MANUFACTURA: {
    category: 'MANUFACTURA',
    label: 'Manufactura / Industria',
    mpKeywords: [
      'materia prima', 'insumo', 'material productivo',
      'chapa', 'alambre', 'hierro', 'acero', 'aluminio', 'cobre',
      'plástico', 'resina', 'polietileno', 'polipropileno', 'PVC',
      'tela', 'hilo', 'tinta', 'pintura industrial',
      'madera', 'tablero', 'MDF', 'aglomerado',
      'vidrio', 'cerámica', 'porcelana',
      'papel', 'cartón', 'bobina', 'rollo',
      'solvente', 'diluyente', 'adhesivo', 'pegamento',
      'químico', 'producto químico', 'reactivo',
      'envase', 'embalaje', 'packaging',
      'componente', 'pieza', 'parte', 'repuesto producción',
    ],
    cipKeywords: [
      'alquiler planta', 'alquiler galpón', 'alquiler nave industrial',
      'seguro planta', 'seguro maquinaria',
      'mantenimiento máquinas', 'mantenimiento equipos',
      'energía eléctrica', 'electricidad', 'luz eléctrica',
      'gas natural', 'vapor',
      'agua industrial', 'tratamiento efluentes',
      'transporte', 'flete', 'logística',
      'depreciación', 'amortización',
      'limpieza industrial', 'residuos',
    ],
    modKeywords: [
      'operario', 'operarios', 'línea de producción', 'personal producción',
      'horas extra', 'turno', 'jornada producción',
    ],
    eventKeywords: [
      'paró la máquina', 'falla de equipos', 'avería',
      'corte de luz', 'corte de gas', 'paró la planta',
      'paro sindical', 'huelga', 'lock-out',
      'incendio planta', 'explosión',
    ],
    lossKeywords: [
      'producto defectuoso', 'rechazo calidad', 'scrap', 'desperdicio',
      'merma de proceso', 'rotura en proceso',
    ],
    energyIsMP: false,  // podría ser MP en fundición/cerámica, pero default CIP
    fuelIsMP: false,
  },

  CONSTRUCCION: {
    category: 'CONSTRUCCION',
    label: 'Construcción / Obras',
    mpKeywords: [
      'cemento', 'hormigón', 'hormigon', 'arena', 'canto rodado', 'cascajo',
      'hierro', 'varilla', 'malla', 'alambre para construcción',
      'ladrillo', 'bloque', 'adoquín', 'loseta', 'baldosa', 'cerámica',
      'madera obra', 'tirante', 'viga', 'encofrado',
      'pintura', 'látex', 'esmalte', 'impermeabilizante',
      'cañería', 'caño', 'fitting', 'válvula',
      'cable eléctrico', 'tablero', 'disyuntor',
      'yeso', 'revoque', 'membrana', 'aislante',
      'vidrio', 'ventana', 'puerta', 'marco',
    ],
    cipKeywords: [
      'alquiler andamio', 'alquiler retroexcavadora', 'alquiler hormigonera',
      'alquiler equipo', 'alquiler maquinaria vial',
      'seguro obra', 'ART construcción',
      'transporte material', 'flete materiales',
      'honorarios arquitecto', 'honorarios ingeniero',
      'permiso de obra', 'visado plano', 'habilitación obra',
      'electricidad provisional obra',
    ],
    modKeywords: [
      'albañil', 'plomero', 'electricista', 'carpintero',
      'mano de obra obra', 'jornal', 'destajero',
      'subcontratista', 'cuadrilla',
    ],
    eventKeywords: [
      'lluvia paró obra', 'suspensión por lluvia', 'día de lluvia',
      'accidente obra', 'herido en obra',
      'vecino denunció', 'municipio paró obra',
    ],
    lossKeywords: [
      'material robado', 'material húmedo', 'cemento fraguado',
      'desperdicio material',
    ],
    energyIsMP: false,
    fuelIsMP: false,
  },

  TEXTIL: {
    category: 'TEXTIL',
    label: 'Textil / Indumentaria',
    mpKeywords: [
      'tela', 'género', 'tejido', 'tul', 'encaje', 'raso',
      'hilo', 'hilo de coser', 'hilo bordado',
      'botón', 'cierre', 'hebilla', 'broche', 'velcro', 'elástico',
      'tinte', 'tintura', 'colorante textil',
      'entretela', 'forro', 'relleno', 'guata',
      'etiqueta', 'hangtag', 'bolsa poly',
      'cinta métrica', 'patrón', 'molde',
    ],
    cipKeywords: [
      'alquiler taller', 'alquiler local',
      'mantenimiento máquina de coser', 'servicio máquina',
      'electricidad taller', 'luz taller',
      'transporte colecciones', 'flete mercadería',
      'seguro taller',
    ],
    modKeywords: [
      'costurera', 'costureras', 'bordadora', 'tejedor',
      'personal confección', 'producción por pieza', 'destajo',
    ],
    eventKeywords: [
      'corte de luz paró la producción',
      'máquina rota', 'avería máquina de coser',
    ],
    lossKeywords: [
      'tela manchada', 'defecto tela', 'corte mal hecho',
      'merma tela',
    ],
    energyIsMP: false,
    fuelIsMP: false,
  },

  SALUD: {
    category: 'SALUD',
    label: 'Salud / Farmacia',
    mpKeywords: [
      'medicamento', 'droga', 'fármaco', 'farmaco', 'principio activo',
      'insumo médico', 'material descartable médico',
      'jeringa', 'guante', 'gasa', 'vendaje', 'catéter',
      'reactivo laboratorio', 'kit diagnóstico', 'tira reactiva',
      'vacuna', 'suero', 'solución fisiológica', 'glucosa',
      'rayos X', 'film radiológico', 'contraste',
      'prótesis', 'implante', 'material quirúrgico',
    ],
    cipKeywords: [
      'alquiler consultorio', 'alquiler clínica',
      'mantenimiento equipo médico', 'calibración',
      'habilitación sanitaria', 'ANMAT', 'ministerio salud',
      'seguro mala praxis', 'seguro médico',
      'electricidad clínica', 'gas clínica',
    ],
    modKeywords: [
      'sueldo médico', 'sueldo enfermero', 'honorario médico',
      'guardia', 'turno médico',
    ],
    eventKeywords: [
      'habilitación vencida', 'inspección ANMAT', 'alerta sanitaria',
      'corte de frío vacunas', 'falla cadena de frío',
    ],
    lossKeywords: [
      'medicamento vencido', 'vacuna inutilizada',
      'insumo en mal estado',
    ],
    energyIsMP: false,
    fuelIsMP: false,
  },

  SERVICIOS: {
    category: 'SERVICIOS',
    label: 'Servicios Profesionales / IT',
    mpKeywords: [
      // En servicios casi no hay MP, pero algunos insumos son directos
      'licencia software', 'suscripción cloud', 'API', 'hosting',
      'dominio', 'SSL', 'servidor',
      'papel', 'tóner', 'cartucho', 'resma',  // para estudios
    ],
    cipKeywords: [
      'alquiler oficina', 'coworking',
      'internet', 'telefonía', 'celular',
      'software administrativo', 'CRM', 'ERP',
      'seguro responsabilidad civil', 'seguro contenido',
      'electricidad oficina', 'agua',
      'limpieza oficina', 'seguridad',
    ],
    modKeywords: [
      'honorario', 'consultoría', 'sueldo profesional',
      'horas de servicio', 'factura honorarios',
    ],
    eventKeywords: [
      'corte de internet', 'caída del servidor', 'hack', 'ataque informático',
      'incendio oficina', 'robo equipos',
    ],
    lossKeywords: [
      'pérdida de datos', 'equipo robado', 'laptop robada',
    ],
    energyIsMP: false,
    fuelIsMP: false,
  },

  COMERCIO: {
    category: 'COMERCIO',
    label: 'Comercio / Distribución',
    mpKeywords: [
      // En comercio, la mercadería es el "insumo" principal
      'mercadería', 'stock', 'producto para reventa',
      'compra de mercadería', 'reposición stock',
    ],
    cipKeywords: [
      'alquiler local', 'alquiler depósito',
      'flete', 'transporte mercadería', 'logística',
      'seguro mercadería', 'seguro local',
      'electricidad local', 'gas local',
      'cámara de seguridad', 'alarma',
    ],
    modKeywords: [
      'sueldo vendedor', 'comisión ventas', 'personal local',
    ],
    eventKeywords: [
      'robo', 'hurto', 'asalto', 'entradera',
      'clausura comercial', 'habilitación vencida',
      'desabastecimiento', 'quiebre de stock',
    ],
    lossKeywords: [
      'mercadería robada', 'stock faltante', 'rotura mercadería',
      'mercadería vencida', 'producto vencido',
    ],
    energyIsMP: false,
    fuelIsMP: false,
  },

  TRANSPORTE: {
    category: 'TRANSPORTE',
    label: 'Transporte / Logística',
    mpKeywords: [
      'gasoil', 'combustible', 'nafta', 'GNC', 'gas natural comprimido',
      'lubricante', 'aceite motor', 'neumático', 'goma', 'cubiertas',
      'repuesto', 'filtro', 'pastillas freno', 'batería',
      'peaje', 'rodado',
    ],
    cipKeywords: [
      'seguro automotor', 'seguro flota', 'VTV', 'revisión técnica',
      'patente', 'registro', 'habilitación transporte',
      'alquiler cochera', 'garaje',
      'rastreo GPS', 'monitoreo flota',
    ],
    modKeywords: [
      'sueldo chofer', 'viático', 'horas chofer',
    ],
    eventKeywords: [
      'accidente vial', 'choque', 'siniestro vehicular',
      'ruta cortada', 'piquete', 'corte de ruta',
    ],
    lossKeywords: [
      'carga robada', 'carga dañada', 'derrame',
    ],
    energyIsMP: true,  // combustible es MP en transporte
    fuelIsMP: true,
  },

  DEFAULT: {
    category: 'DEFAULT',
    label: 'Genérico',
    mpKeywords: [
      'materia prima', 'insumo', 'material', ' kg', 'litro', 'tonelada',
      'bobina', 'rollo', 'envase', 'embalaje', 'chapa', 'alambre',
      'tela', 'hilo', 'resina', 'pintura', 'solvente', 'madera',
      'cartón', 'plástico',
    ],
    cipKeywords: [
      'alquiler', 'alq.', 'servicio', 'energía', 'energia', 'electricidad',
      'gas', 'mantenimiento', 'mant.', 'seguro', 'limpieza', 'vigilancia',
      'telefonía', 'telefonia', 'internet', 'agua', 'abono', 'cuota',
    ],
    modKeywords: [],
    eventKeywords: [],
    lossKeywords: [],
    energyIsMP: false,
    fuelIsMP: false,
  },
};

// ── Detección de categoría de industria ──────────────────────────────────────

const AGRO_RE    = /agro|campo|cosech|ganad|tambo|avicultur|vitivin|soja|maíz|trigo|cereales|semiller|apicult|citrus|frutícol|cultivo/i;
const GASTRO_RE  = /gastronom|restaurant|panadería|heladería|catering|aliment|cocina|bar\b|cafeter|confiter|rotisería|delivery comida/i;
const MANUF_RE   = /manufactur|industri|fabrica|produccion|planta|metalurg|plastico|quimic|farmacéut|cervecera|frigorif|molino/i;
const CONST_RE   = /construcc|inmobiliar|obra|arquitect|demolici|excavac|paviment|sanitari/i;
const TEXTIL_RE  = /textil|confección|indumentar|costura|moda\b|taller costura/i;
const SALUD_RE   = /salud|farmac|clínica|hospital|médic|odontolog|veterinar|laborator|óptic/i;
const SERV_RE    = /servicios profesion|consultora|software|tecnolog|IT\b|sistemas|abogad|contador|publicidad|marketing/i;
const COMER_RE   = /comercio|distribuc|tienda|negocio|minorista|mayorista|retail/i;
const TRANS_RE   = /transport|logístic|flete|flota|camión|empresa de viajes|remis/i;

export function categorizeIndustry(industry: string | null | undefined): IndustryCategory {
  if (!industry) return 'DEFAULT';
  if (AGRO_RE.test(industry))   return 'AGRO';
  if (GASTRO_RE.test(industry)) return 'GASTRONOMIA';
  if (MANUF_RE.test(industry))  return 'MANUFACTURA';
  if (CONST_RE.test(industry))  return 'CONSTRUCCION';
  if (TEXTIL_RE.test(industry)) return 'TEXTIL';
  if (SALUD_RE.test(industry))  return 'SALUD';
  if (SERV_RE.test(industry))   return 'SERVICIOS';
  if (COMER_RE.test(industry))  return 'COMERCIO';
  if (TRANS_RE.test(industry))  return 'TRANSPORTE';
  return 'DEFAULT';
}

export function getIndustryProfile(category: IndustryCategory): IndustryProfile {
  return PROFILES[category];
}
