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
  /**
   * AGRO — agricultura extensiva, ganadería y tambo.
   *
   * QUÉ SE CORRIGIÓ Y POR QUÉ. Este perfil quedó escrito pensando solo en el
   * cultivo, y arrastraba los dos mismos defectos que CL-04 ya había medido y
   * corregido en AVICULTURA (ver el comentario de ese perfil):
   *
   *   · `fuelIsMP: true` + 'gasoil'/'combustible' en mpKeywords. El gasoil del
   *     tractor NO se incorpora al grano: es FUERZA MOTRIZ, que la cátedra lista
   *     como componente de CIP (Clase 1, l. 64; Clase 11, l. 211). El eje es
   *     R-MP-DIRECTA (Clase 1, l. 58): materia prima es lo identificable CON el
   *     objeto de costo, y el combustible mueve la máquina, no se vuelve soja.
   *     Medido en avicultura como el error CIP-02 (confianza 97).
   *   · 'vacuna' / 'veterinaria' / 'antiparasitario' en mpKeywords. La sanidad
   *     del rodeo sostiene al animal, no se incorpora al litro de leche ni al
   *     kilo de carne → material indirecto, CIP por R-MP-INDIRECTA. Es el error
   *     CIP-04, también con confianza 97.
   *
   * Bajo el perfil viejo, un tambo o un establecimiento de ganadería —el tipo de
   * cliente que sigue cayendo acá, porque AGRO_RE matchea 'tambo' y 'ganad'—
   * mandaba a MATERIA PRIMA cada factura de gasoil y cada factura del
   * veterinario, con confianza 88 y sin que la IA las viera.
   *
   * Lo que SÍ es materia prima en ganadería/tambo (el alimento: forraje,
   * balanceado, pellet) se mantiene: eso sí se convierte en leche y en carne.
   */
  AGRO: {
    category: 'AGRO',
    label: 'Agropecuario',
    mpKeywords: [
      'semilla', 'simiente', 'agroquímico', 'agroquimico', 'herbicida', 'fungicida',
      'insecticida', 'fertilizante', 'abono', 'inoculante', 'fosfato',
      'forraje', 'alimento balanceado', 'pellet', 'silo',
      'bolsa', 'bolsón', 'arpillera', 'envase agrícola',
      'riego', 'goteo', 'aspersor',
      'soja', 'maíz', 'trigo', 'girasol', 'sorgo', 'algodón',
      'vid', 'uva', 'mosto', 'sulfato de cobre',
      //
      // NO ESTÁN ACÁ, A PROPÓSITO (están en cipKeywords):
      //  · 'gasoil'/'combustible'/'nafta'/'lubricante' → fuerza motriz.
      //  · 'vacuna'/'veterinaria'/'antiparasitario' → sanidad del rodeo.
      // Ver el comentario de cabecera de este perfil.
    ],
    cipKeywords: [
      'alquiler campo', 'arrendamiento', 'flete', 'transporte grano',
      'seguro agrícola', 'seguro granizo', 'seguro climático',
      'servicio de cosecha', 'contratista cosecha', 'trilla',
      'pulverización aérea', 'siembra directa servicio',
      'honorarios agrónomo', 'análisis suelo',
      'mantenimiento maquinaria', 'reparacion tractor', 'repuesto agrícola',
      'telefonía rural', 'internet rural', 'electricidad rural',
      // Fuerza motriz de la maquinaria — mueve el tractor, no se vuelve grano.
      'gasoil', 'combustible', 'nafta', 'lubricante',
      // Sanidad del rodeo — material indirecto (no se incorpora al producto).
      'veterinaria', 'veterinario', 'producto veterinario', 'medicamento veterinario',
      'honorarios veterinario', 'vacuna', 'vacunación', 'vacunacion',
      'antiparasitario', 'medicamento animal', 'sanidad animal', 'desparasitación',
      'desparasitacion',
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
    // ⚠️ Era `true` ("combustible de tractores = insumo de producción"). Es el
    // mismo defecto que CL-04 corrigió en AVICULTURA: el gasoil es fuerza motriz
    // (CIP), no materia prima. Con `true`, CUALQUIER factura de combustible de un
    // campo, un tambo o un establecimiento ganadero se imputaba a MATERIA PRIMA
    // con confianza 88 y sin pasar por la IA.
    fuelIsMP: false,
  },

  /**
   * AVICULTURA DE POSTURA — el rubro del primer cliente pago (~200.000 ponedoras).
   *
   * POR QUÉ EXISTE (medido, no supuesto). Hasta CL-04 este cliente se atendía con
   * el perfil AGRO, escrito para agricultura extensiva. Tres de los siete errores
   * de alta confianza de la auditoría del 06/08/2026 salen de esa suplantación:
   *   · `fuelIsMP: true` mandaba el gasoil del grupo electrógeno a MATERIA PRIMA
   *     (regla escrita para tractores de cultivo).            → CIP-02, conf 97
   *   · `'vacuna'` estaba en los mpKeywords de AGRO.          → CIP-04, conf 97
   *   · la luz del galpón no matcheaba nada: AGRO solo tiene
   *     'electricidad rural'.                                 → CIP-01, conf 97
   * Medido además: el corpus bajo AGRO da PEOR accuracy que sin perfil (DEFAULT).
   * Un perfil mal calibrado es peor que ninguno, así que este tiene que ganarle a
   * los dos para justificar su existencia (ver corpus-clasificador/ground-truth.md).
   *
   * EL EJE QUE ORDENA TODAS LAS LISTAS es R-MP-DIRECTA (Clase 1, l. 58):
   * "identificable con el objeto de costo". El objeto de costo acá es EL HUEVO.
   * Lo que se convierte en huevo (alimento, calcio de la cáscara) es MP directa;
   * lo que sostiene al plantel sin incorporarse al huevo (sanidad, energía,
   * calefacción, mantenimiento) es CIP por R-MP-INDIRECTA y R-CIP (Clase 1, l. 64).
   *
   * ⚠️ LO QUE ESTE PERFIL NO RESUELVE — SUBPRODUCTOS. La gallina de descarte y el
   * huevo roto son salidas reales y recurrentes de una explotación de postura, y
   * la cátedra tiene reglas para ellas (Clase 43: subproducto Categoría 1 =
   * reconocer al vender; Categoría 2 = deducir del costo del producto principal).
   * NO se implementó ningún tratamiento acá porque el clasificador no tiene dónde
   * expresarlo: `CostSection` no tiene una sección de "recupero / reducción del
   * costo de producción", así que la Categoría 2 no es representable. Ver la
   * pregunta abierta en ground-truth.md. Consecuencia deliberada: NO hay keywords
   * de 'gallina de descarte' en ninguna lista — enviarla a lossKeywords sería
   * declararla merma, que es exactamente lo que no es.
   */
  AVICULTURA: {
    category: 'AVICULTURA',
    label: 'Avicultura de postura',
    mpKeywords: [
      // Alimento: es LA materia prima de una postura (el grueso del costo). Se
      // transforma en huevo → R-MP-DIRECTA.
      // OJO: 'ración'/'racion' se probaron y se SACARON porque el match de layer4
      // era por substring (`lower.includes`) y 'ración' está adentro de
      // "repa-ración": le sumaba un punto de Materia Prima a cualquier factura de
      // mantenimiento. Medido sobre CIP-MANT-GALPON ("reparación de comederos").
      // ESA CAUSA YA NO EXISTE: el matcheo ahora respeta el límite de palabra
      // (utils/keyword-match.ts), así que 'ración' no matchearía "reparación".
      // Se las deja afuera igual porque el alimento ya queda cubierto por
      // 'balanceado' y 'alimento balanceado', y agregar keywords redundantes
      // infla el score de MP sin aportar cobertura.
      'balanceado', 'alimento balanceado', 'alimento para ponedora',
      'maíz', 'maiz', 'sorgo', 'soja', 'expeller',
      'harina de soja', 'poroto de soja', 'afrechillo', 'salvado de trigo',
      'aceite vegetal', 'grasa vegetal',
      // Núcleos, premezclas y aminoácidos: entran a la ración, se incorporan al huevo.
      'núcleo vitamínico', 'nucleo vitaminico', 'núcleo mineral', 'nucleo mineral',
      'premezcla', 'corrector vitamínico', 'corrector vitaminico',
      'metionina', 'lisina', 'aminoácido', 'aminoacido',
      // Fuente de calcio: se convierte literalmente en la cáscara del huevo.
      'carbonato de calcio', 'conchilla', 'cáscara de ostra', 'cascara de ostra',
      'fosfato bicálcico', 'fosfato bicalcico', 'calcáreo', 'calcareo',
      // Envase del producto terminado. ⚠️ PREGUNTA ABIERTA (ground-truth.md §1):
      // por R-MP-DIRECTA el maple es identificable con el objeto de costo (uno cada
      // 30 huevos) y por eso está acá; por R-MP-INDIRECTA podría defenderse que es
      // de importe mínimo → material indirecto → CIP. La cátedra no zanja el caso.
      // Se sigue el requisito de CL-04 y queda declarado, no decidido en silencio.
      'maple', 'maples', 'huevera', 'estuche para huevo', 'caja para huevos',
      //
      // NO ESTÁN ACÁ, A PROPÓSITO:
      //  · 'gasoil'/'combustible' → fuerza motriz y calefacción, no se incorporan
      //    al huevo (es el defecto CIP-02 que este perfil viene a corregir).
      //  · 'vacuna'/'antibiótico' → material indirecto (defecto CIP-04).
      //  · 'gallina'/'ponedora'/'pollita' → el plantel es un ACTIVO amortizable, no
      //    un insumo del período: comprarlo no es consumo de MP. Lo que sí es costo
      //    del período es su amortización, que está en cipKeywords.
    ],
    cipKeywords: [
      // Energía eléctrica y fuerza motriz — R-CIP (Clase 1, l. 64) y Clase 11,
      // l. 211 ("energía eléctrica: iluminación y fuerza motriz").
      'energía eléctrica', 'energia electrica', 'electricidad',
      'luz eléctrica', 'luz electrica', 'kwh',
      'suministro eléctrico', 'suministro electrico',
      'grupo electrógeno', 'grupo electrogeno',
      'generador eléctrico', 'generador electrico',
      // Calefacción y ventilación del galpón — la cátedra nombra "calefacción"
      // como componente de CIP en la misma línea que la energía.
      'calefacción', 'calefaccion', 'calefactor', 'campana calefactora',
      'ventilación', 'ventilacion', 'extractor', 'panel de enfriamiento',
      'gas envasado', 'garrafa', 'gas natural',
      // Sanidad del plantel: NO se incorpora al huevo → material indirecto, que es
      // componente de CIP por R-MP-INDIRECTA y Clase 11, l. 206.
      'vacuna', 'vacunación', 'vacunacion', 'antibiótico', 'antibiotico',
      'antiparasitario', 'coccidiostato', 'desinfectante',
      'desinfección', 'desinfeccion', 'sanidad', 'bioseguridad',
      'producto veterinario', 'medicamento veterinario',
      'honorarios veterinario', 'honorarios veterinaria',
      'análisis de laboratorio', 'analisis de laboratorio', 'necropsia',
      'control de plagas', 'desratización', 'desratizacion',
      'fumigación', 'fumigacion',
      // Estructura productiva: mantenimiento y equipamiento del galpón.
      'mantenimiento de galpones', 'mantenimiento de galpón', 'mantenimiento de galpon',
      'reparación de galpón', 'reparacion de galpon',
      'comedero', 'bebedero', 'jaula', 'nidal',
      'cinta de recolección', 'cinta de recoleccion',
      'chapa de techo', 'chapas de techo',
      'cama de galpón', 'cama de galpon', 'viruta', 'cascarilla de arroz',
      // Agua de bebida del plantel.
      'agua de bebida', 'perforación', 'perforacion', 'bomba de agua',
      // Amortización del plantel: la gallina es un activo que se consume a lo largo
      // del ciclo de postura. La amortización es CIP (Clase 1, l. 64; Clase 11).
      'amortización del plantel', 'amortizacion del plantel',
      'amortización de gallinas', 'amortizacion de gallinas',
      // Servicios del establecimiento.
      'alquiler de campo', 'arrendamiento', 'seguro del establecimiento',
      'telefonía rural', 'telefonia rural', 'internet rural',
    ],
    modKeywords: [
      // MOD = quien manipula el plantel y el huevo en el galpón — R-MOD (Clase 1,
      // l. 59, "transforma la MP en producto final, identificable").
      'operario de galpón', 'operario de galpon',
      'operarios de galpón', 'operarios de galpon',
      'personal de galpón', 'personal de galpon', 'galponero', 'galponeros',
      'peón de galpón', 'peon de galpon',
      'recolector de huevo', 'recolección de huevo', 'recoleccion de huevo',
      'clasificador de huevo', 'clasificación de huevo', 'clasificacion de huevo',
      'envasador de huevo', 'jornal de galpón', 'jornal de galpon',
      'mano de obra de galpón', 'mano de obra de galpon',
      //
      // NO ESTÁN ACÁ, A PROPÓSITO: 'capataz', 'encargado', 'supervisor' y todo lo
      // veterinario. No transforman la MP → son mano de obra INDIRECTA y por
      // R-MOI (Clase 1, l. 60) son componente de CIP, no de MOD.
    ],
    eventKeywords: [
      // Sanitarios: se nombran como BROTE, no por el patógeno suelto. "newcastle"
      // a secas también aparece en una factura de vacunas, que es una compra
      // rutinaria y no un evento de negocio.
      'brote de newcastle', 'brote de influenza aviar', 'gripe aviar',
      'brote sanitario', 'cuarentena sanitaria', 'despoblamiento',
      'clausura sanitaria', 'senasa clausuró', 'senasa clausuro',
      // Térmicos: la mortandad por calor es EL evento climático de una postura.
      'ola de calor', 'golpe de calor', 'estrés térmico', 'estres termico',
      // Corte de energía: sin ventilación forzada el galpón se muere en horas.
      'corte de luz', 'corte de energía', 'corte de energia',
      'se cortó la luz', 'se corto la luz',
      'falló el grupo electrógeno', 'fallo el grupo electrogeno',
      'se quedaron sin agua',
      'caída de postura', 'caida de postura', 'bajó la postura', 'bajo la postura',
    ],
    lossKeywords: [
      // OJO CON LA SEMÁNTICA: layer0a trata una lossKeyword sin naturaleza
      // declarada como merma AMBIGUA → revisión humana obligatoria. Acá eso es lo
      // correcto, no una omisión: la cátedra (Clase 21) define la pérdida NORMAL
      // por un umbral de tolerancia "establecido por la empresa o el ingeniero
      // (generalmente entre 1% y 10%)" — la absorben las unidades buenas — y la
      // EXTRAORDINARIA como la que lo supera y va al estado de resultados. Ese
      // umbral no está en el texto del comprobante, así que el sistema no puede
      // decidir cuál de las dos es sin preguntar.
      'mortandad', 'mortalidad del plantel', 'gallinas muertas', 'gallina muerta',
      'huevo roto', 'huevos rotos', 'huevo quebrado', 'huevos quebrados',
      'huevo fisurado', 'huevos fisurados', 'huevo sucio', 'huevos sucios',
      'huevo descartado', 'huevos descartados', 'merma de postura',
      //
      // NO ESTÁ ACÁ, A PROPÓSITO: 'gallina de descarte'. No es una merma sino el
      // fin planificado del ciclo productivo del plantel. Ver el comentario de
      // cabecera y la pregunta abierta de ground-truth.md.
    ],
    energyIsMP: false, // la luz del galpón es CIP, nunca insumo del huevo
    fuelIsMP: false,   // ⚠️ ESTE es el fix de CIP-02: el gasoil del grupo
                       // electrógeno y de la calefacción es fuerza motriz, no MP
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

  /**
   * TRANSPORTE — el objeto de costo es EL VIAJE (el servicio prestado).
   *
   * QUÉ SE CORRIGIÓ. Este perfil tenía `energyIsMP: true` SIN NINGUNA CONDICIÓN.
   * En layer4-invoice-routing esa bandera se evalúa contra un regex que matchea
   * 'electricidad', 'luz eléctrica', 'gas natural' y 'energía' sueltos, así que
   * la factura de LUZ de un transportista —el galpón, la cochera, la oficina—
   * se imputaba a MATERIA PRIMA con confianza 85 y `requiresAI: false`: la IA no
   * llegaba ni a verla. Nada de la energía eléctrica de un depósito se incorpora
   * al viaje; es el ejemplo de manual de un costo indirecto (Clase 1, l. 64).
   *
   * Lo que sí es insumo directo del servicio es EL COMBUSTIBLE QUE QUEMA EL
   * CAMIÓN, y eso lo cubre `fuelIsMP: true` — que se mantiene, con su regex
   * propio (gasoil/combustible/nafta) — más las keywords de MP de abajo, donde
   * el GNC entra por nombre. O sea: el caso legítimo que la bandera de energía
   * pretendía cubrir ya estaba cubierto por la de combustible, y lo único que
   * agregaba `energyIsMP: true` era el falso positivo.
   */
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
      // Energía del depósito/cochera/oficina: es lo que `energyIsMP: true`
      // mandaba a Materia Prima. Se nombra explícito acá además de estar en
      // UNIVERSAL_CIP_KEYWORDS, para que el motivo quede a la vista en el perfil.
      'energía eléctrica', 'energia electrica', 'electricidad', 'luz del depósito',
      // El gas del depósito/oficina. No pisa al GNC: 'gas natural comprimido' es
      // combustible y lo resuelve el regex `hasFuel` de layer4-invoice-routing,
      // que corre ANTES del conteo de keywords.
      'gas natural',
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
    // ⚠️ Era `true` con el comentario "combustible es MP en transporte", pero la
    // bandera que habla del combustible es la de abajo: ésta gobierna la
    // ELECTRICIDAD y el gas. Ver el comentario de cabecera de este perfil.
    energyIsMP: false,
    fuelIsMP: true, // el gasoil del camión sí es insumo directo del viaje
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

// AVICOLA_RE se evalúa ANTES que AGRO_RE a propósito. AGRO_RE matchea 'agro',
// 'campo', 'ganad' y 'avicultur', así que casi cualquier forma de describir una
// granja avícola caía en AGRO — que es exactamente el defecto que CL-04 corrige.
// Si esta constante se evaluara después, el cliente seguiría cayendo en AGRO por
// la palabra "agropecuaria" o "avicultura" y el perfil nuevo no se usaría nunca.
const AVICOLA_RE = /av[íi]col|avicultur|ponedora|gallina|granja de huevos?|producci[óo]n de huevos?|postura de huevos?/i;
// Contrapeso a AVICOLA_RE. "Avícola" también aparece en empresas que NO crían el
// plantel: un frigorífico avícola es una planta de faena (su MP es el ave, no el
// balanceado) y una distribuidora avícola revende. Mandarlas a AVICULTURA sería
// repetir el error que este perfil corrige — atender un rubro con el perfil de
// otro— solo que en la dirección contraria. Caen en MANUFACTURA / COMERCIO.
const AVICOLA_NO_RE = /frigor[íi]f|matadero|faena|distribuidor|comercializadora|mayorista|minorista/i;
const AGRO_RE    = /agro|campo|cosech|ganad|tambo|vitivin|soja|maíz|trigo|cereales|semiller|apicult|citrus|frutícol|cultivo/i;
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
  if (AVICOLA_RE.test(industry) && !AVICOLA_NO_RE.test(industry)) return 'AVICULTURA';
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
