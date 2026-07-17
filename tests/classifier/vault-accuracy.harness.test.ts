/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HARNESS DE EFECTIVIDAD DEL CLASIFICADOR vs. CRITERIOS DE LA CÁTEDRA (Mirta)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * QUÉ MIDE
 * --------
 * Corre un dataset de "cargos" contra `classifyDocument` — el MISMO motor que
 * invoca el Portal de Operador (`empresa-portal-service.ts` → Step 6). Cada
 * cargo es texto tal como llega al clasificador: lo que Groq OCR extrae de la
 * foto de una factura / recibo, o lo que el operador pega.
 *
 * La sección esperada (`expected`) se deriva del vault Obsidian
 * "001 - Costear / 001.1 - Clases (Mirta)", Clase 1 (Clasificación de costos):
 *   - MATERIA_PRIMA:      insumo que se consume en producción, identificable (MP directa).
 *   - MANO_DE_OBRA:       recibos / liquidaciones / horas del personal que transforma la MP (MOD).
 *   - COSTOS_INDIRECTOS:  todo lo de PRODUCCIÓN que no es MP ni MOD directa
 *                         (alquiler planta, energía, seguro, mantenimiento, limpieza, flete, notas déb/créd).
 *   - VENTAS:             facturas de venta emitidas / remitos de salida.
 *   - DESCONOCIDO:        no se puede auto-clasificar con seguridad → escala a revisión humana.
 *
 * DOS CATEGORÍAS DE CASO
 * ----------------------
 *   kind: 'core' → casos operativos normales. Cuentan para la métrica de accuracy.
 *   kind: 'gap'  → divergencias CONOCIDAS entre el criterio de cátedra y lo que
 *                  el sistema puede hoy. NO cuentan para la métrica; se reportan
 *                  aparte para que el equipo decida si vale corregirlas.
 *
 * NOTA SOBRE LA IA (Layer 5)
 * --------------------------
 * Con GROQ_API_KEY placeholder la IA está deshabilitada; los casos que las
 * reglas deterministas no resuelven escalan a revisión humana (requiresReview).
 * El texto informal (sin estructura de factura) depende de la IA — cargá un key
 * válido para medir ese camino.
 *
 * CÓMO CORRERLO
 * -------------
 *   npx vitest run tests/classifier/vault-accuracy.harness.test.ts --reporter=basic
 */
import { describe, it, expect } from 'vitest';
import { classifyDocument } from '@/infrastructure/classifier/cascade-classifier.js';
import type { CostSection } from '@/infrastructure/classifier/types.js';

// UUIDs válidos → evita el ruido de prisma en getCorrectionExamples.
const BASE = {
  costistId: '00000000-0000-4000-8000-000000000001',
  companyId: '00000000-0000-4000-8000-000000000002',
  dataEntryId: '00000000-0000-4000-8000-000000000003',
};

interface Case {
  id: string;
  kind: 'core' | 'gap';
  industry: string;
  text: string;
  expected: CostSection;
  note: string;
}

// ── Helpers para armar documentos realistas (post-OCR) ───────────────────────
let caeSeq = 75000000000000;
const cae = () => String(++caeSeq).padStart(14, '0');

/** Factura de COMPRA (proveedor → empresa). */
const facCompra = (prov: string, items: string) =>
  `FACTURA A\nCAE Nº: ${cae()}\nCUIT: 30-12345678-9\nPUNTO DE VENTA 0001\nProveedor: ${prov}\nCondición frente al IVA: Responsable Inscripto\nFecha: 10/06/2026\n${items}`;

/** Factura de VENTA (empresa → cliente). */
const facVenta = (detalle: string) =>
  `FACTURA B de venta\nCAE Nº: ${cae()}\nCUIT: 30-12345678-9\nPUNTO DE VENTA 0002\nventa a cliente\nFecha: 10/06/2026\n${detalle}`;

/** Recibo de sueldo / liquidación de haberes. */
const recibo = (detalle: string) =>
  `RECIBO DE SUELDO\n${detalle}\nSUELDO BÁSICO\nOBRA SOCIAL: OSDE\nANSES\nCUIL 20-33445566-7\nFecha: 01/06/2026`;

const CASES: Case[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // CORE — MATERIA PRIMA (insumo directo consumido en producción)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'MP-agro-01', kind: 'core', industry: 'Productora agropecuaria de soja', text: facCompra('Agroinsumos del Norte SRL', '500 bolsas de fertilizante fosfato\n200 L de herbicida glifosato'), expected: 'MATERIA_PRIMA', note: 'insumo agrícola directo' },
  { id: 'MP-agro-02', kind: 'core', industry: 'Tambo y ganadería agropecuaria', text: facCompra('Nutrición Animal SRL', '3000 kg de alimento balanceado\nforraje para ganado'), expected: 'MATERIA_PRIMA', note: 'forraje/balanceado = MP agro' },
  { id: 'MP-agro-03', kind: 'core', industry: 'Semillero agropecuario', text: facCompra('Semillas del Sur SA', '400 bolsas de semilla de soja\ninoculante y fungicida'), expected: 'MATERIA_PRIMA', note: 'semilla = MP agro' },
  { id: 'MP-gastro-01', kind: 'core', industry: 'Restaurante / gastronomía', text: facCompra('Frigorífico El Ternero SA', '80 kg carne vacuna\n30 kg pollo'), expected: 'MATERIA_PRIMA', note: 'carne = MP gastronomía' },
  { id: 'MP-gastro-02', kind: 'core', industry: 'Panadería / gastronomía', text: facCompra('Molinos del Centro SA', '500 kg harina 000\n100 kg azúcar\n20 kg levadura'), expected: 'MATERIA_PRIMA', note: 'secos = MP gastronomía' },
  { id: 'MP-gastro-03', kind: 'core', industry: 'Pescadería / gastronomía', text: facCompra('Mar Argentino SA', '40 kg pescado fresco\n15 kg mariscos'), expected: 'MATERIA_PRIMA', note: 'pescado/mariscos = MP gastronomía' },
  { id: 'MP-gastro-04', kind: 'core', industry: 'Restaurante / gastronomía', text: facCompra('Mercado Central SA', 'cajones de verdura, fruta y tomate\nlechuga y cebolla'), expected: 'MATERIA_PRIMA', note: 'verduras = MP gastronomía' },
  { id: 'MP-manuf-01', kind: 'core', industry: 'Fábrica metalúrgica / manufactura', text: facCompra('Aceros del Litoral SA', '2000 kg chapa de acero AISI 1020\n500 kg alambre'), expected: 'MATERIA_PRIMA', note: 'acero = MP manufactura' },
  { id: 'MP-manuf-02', kind: 'core', industry: 'Fábrica de plásticos / manufactura', text: facCompra('Polímeros Argentinos SA', '1000 kg resina polipropileno\n200 kg colorante'), expected: 'MATERIA_PRIMA', note: 'resina = MP manufactura' },
  { id: 'MP-manuf-03', kind: 'core', industry: 'Mueblería / manufactura de madera', text: facCompra('Maderas del Delta SRL', '30 tableros de MDF\n15 placas de aglomerado\nmadera de pino'), expected: 'MATERIA_PRIMA', note: 'madera/MDF = MP manufactura' },
  { id: 'MP-textil-01', kind: 'core', industry: 'Taller textil de indumentaria', text: facCompra('Textiles Sur SRL', '300 metros de tela algodón\n5 rollos de género'), expected: 'MATERIA_PRIMA', note: 'tela = MP textil' },
  { id: 'MP-textil-02', kind: 'core', industry: 'Taller textil de indumentaria', text: facCompra('Avíos y Mercería SA', '2000 botones\n500 cierres\nelástico y entretela'), expected: 'MATERIA_PRIMA', note: 'avíos = MP textil' },
  { id: 'MP-const-01', kind: 'core', industry: 'Empresa constructora de obras', text: facCompra('Corralón San Cayetano', '100 bolsas de cemento\n5000 ladrillos huecos'), expected: 'MATERIA_PRIMA', note: 'cemento/ladrillo = MP construcción' },
  { id: 'MP-const-02', kind: 'core', industry: 'Empresa constructora de obras', text: facCompra('Hierros del Oeste SRL', '2 toneladas de hierro\nmalla sima\nvarilla del 8'), expected: 'MATERIA_PRIMA', note: 'hierro = MP construcción' },
  { id: 'MP-const-03', kind: 'core', industry: 'Empresa constructora de obras', text: facCompra('Pinturería Obra SA', '40 latas de pintura látex\nesmalte e impermeabilizante\nmembrana'), expected: 'MATERIA_PRIMA', note: 'pintura/membrana = MP construcción' },
  { id: 'MP-salud-01', kind: 'core', industry: 'Clínica / salud', text: facCompra('Insumos Médicos SA', '200 jeringas descartables\ncaja de gasa estéril\nguantes de látex'), expected: 'MATERIA_PRIMA', note: 'insumo médico descartable = MP' },
  { id: 'MP-salud-02', kind: 'core', industry: 'Farmacia / laboratorio de salud', text: facCompra('Droguería del Plata SA', 'lote de medicamentos\nsuero fisiológico\nprincipio activo'), expected: 'MATERIA_PRIMA', note: 'medicamento/droga = MP salud' },
  { id: 'MP-transp-01', kind: 'core', industry: 'Empresa de transporte y fletes', text: facCompra('YPF Estación Ruta 9', '400 litros de gasoil'), expected: 'MATERIA_PRIMA', note: 'combustible = MP en transporte' },
  { id: 'MP-transp-02', kind: 'core', industry: 'Empresa de transporte y fletes', text: facCompra('Neumáticos del Sur SA', '6 neumáticos\nlubricante y aceite motor\nfiltro'), expected: 'MATERIA_PRIMA', note: 'neumático/lubricante = MP transporte' },
  { id: 'MP-comercio-01', kind: 'core', industry: 'Comercio minorista de reventa', text: facCompra('Distribuidora Mayorista SA', 'compra de mercadería para reventa\nreposición stock'), expected: 'MATERIA_PRIMA', note: 'mercadería = insumo principal comercio' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE — MANO DE OBRA (personal que transforma la MP)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'MOD-manuf-01', kind: 'core', industry: 'Fábrica metalúrgica / manufactura', text: recibo('Empleado: Juan Pérez — operario de planta'), expected: 'MANO_DE_OBRA', note: 'recibo operario = MOD' },
  { id: 'MOD-manuf-02', kind: 'core', industry: 'Fábrica de plásticos / manufactura', text: 'LIQUIDACIÓN DE HABERES\nOperarios turno noche\nSUELDO BÁSICO\nANSES\nHORAS EXTRA\nJUBILACIÓN', expected: 'MANO_DE_OBRA', note: 'liquidación de haberes = MOD' },
  { id: 'MOD-textil-01', kind: 'core', industry: 'Taller textil de indumentaria', text: 'LIQUIDACIÓN DE HABERES\nCostureras del taller — período junio 2026\nSUELDO BÁSICO\nOBRA SOCIAL\nCARGAS SOCIALES', expected: 'MANO_DE_OBRA', note: 'liquidación costureras = MOD' },
  { id: 'MOD-gastro-01', kind: 'core', industry: 'Restaurante / gastronomía', text: recibo('Empleado: cocinero principal'), expected: 'MANO_DE_OBRA', note: 'sueldo cocinero = MOD' },
  { id: 'MOD-const-01', kind: 'core', industry: 'Empresa constructora de obras', text: recibo('Empleado: albañil oficial — UOCRA'), expected: 'MANO_DE_OBRA', note: 'jornal albañil = MOD' },
  { id: 'MOD-agro-01', kind: 'core', industry: 'Productora agropecuaria de soja', text: recibo('Empleado: peón rural — jornada de cosecha'), expected: 'MANO_DE_OBRA', note: 'peón rural = MOD' },
  { id: 'MOD-salud-01', kind: 'core', industry: 'Clínica / salud', text: recibo('Empleado: enfermero de guardia'), expected: 'MANO_DE_OBRA', note: 'sueldo enfermero = MOD' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE — COSTOS INDIRECTOS DE PRODUCCIÓN
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'CIP-manuf-01', kind: 'core', industry: 'Fábrica metalúrgica / manufactura', text: facCompra('Edenor SA', 'energía eléctrica planta industrial\nconsumo mes'), expected: 'COSTOS_INDIRECTOS', note: 'electricidad planta = CIP' },
  { id: 'CIP-manuf-02', kind: 'core', industry: 'Fábrica de plásticos / manufactura', text: facCompra('Camuzzi Gas', 'gas natural para proceso de planta'), expected: 'COSTOS_INDIRECTOS', note: 'gas natural planta = CIP' },
  { id: 'CIP-manuf-03', kind: 'core', industry: 'Fábrica metalúrgica / manufactura', text: facCompra('La Segunda Seguros', 'póliza de seguro de maquinaria industrial'), expected: 'COSTOS_INDIRECTOS', note: 'seguro de maquinaria = CIP (keyword con "de")' },
  { id: 'CIP-manuf-04', kind: 'core', industry: 'Fábrica metalúrgica / manufactura', text: facCompra('Limpieza Industrial SRL', 'servicio de limpieza industrial\nretiro de residuos de planta'), expected: 'COSTOS_INDIRECTOS', note: 'limpieza/residuos = CIP' },
  { id: 'CIP-manuf-05', kind: 'core', industry: 'Fábrica metalúrgica / manufactura', text: facCompra('Vigilancia Total SA', 'servicio de vigilancia y seguridad de la planta'), expected: 'COSTOS_INDIRECTOS', note: 'vigilancia = CIP' },
  { id: 'CIP-manuf-06', kind: 'core', industry: 'Fábrica de plásticos / manufactura', text: facCompra('Logística SA', 'flete y logística de despacho de producción'), expected: 'COSTOS_INDIRECTOS', note: 'flete/logística = CIP' },
  { id: 'CIP-gastro-01', kind: 'core', industry: 'Restaurante / gastronomía', text: facCompra('Inmobiliaria Centro', 'alquiler local comercial\nexpensas del mes'), expected: 'COSTOS_INDIRECTOS', note: 'alquiler local = CIP' },
  { id: 'CIP-gastro-02', kind: 'core', industry: 'Restaurante / gastronomía', text: facCompra('Aguas del Norte', 'agua potable del local — servicio mensual'), expected: 'COSTOS_INDIRECTOS', note: 'agua = CIP' },
  { id: 'CIP-gastro-03', kind: 'core', industry: 'Restaurante / gastronomía', text: facCompra('Control de Plagas SRL', 'fumigación y desinfección del local'), expected: 'COSTOS_INDIRECTOS', note: 'fumigación/desinfección = CIP' },
  { id: 'CIP-gastro-04', kind: 'core', industry: 'Restaurante / gastronomía', text: facCompra('Telecom', 'servicio de internet y teléfono del local'), expected: 'COSTOS_INDIRECTOS', note: 'internet/teléfono = CIP' },
  { id: 'CIP-textil-01', kind: 'core', industry: 'Taller textil de indumentaria', text: facCompra('Servicio Técnico Máquinas SRL', 'mantenimiento y reparación de máquina de coser industrial'), expected: 'COSTOS_INDIRECTOS', note: 'mantenimiento = CIP (keyword partida por "y")' },
  { id: 'CIP-textil-02', kind: 'core', industry: 'Taller textil de indumentaria', text: facCompra('Inmobiliaria Norte', 'alquiler del taller de confección'), expected: 'COSTOS_INDIRECTOS', note: 'alquiler taller = CIP' },
  { id: 'CIP-const-01', kind: 'core', industry: 'Empresa constructora de obras', text: facCompra('Alquiler de Equipos Viales SA', 'alquiler de andamios y equipo vial para la obra'), expected: 'COSTOS_INDIRECTOS', note: 'alquiler equipo = CIP' },
  { id: 'CIP-const-02', kind: 'core', industry: 'Empresa constructora de obras', text: facCompra('Provincia ART', 'seguro de obra y ART de la construcción'), expected: 'COSTOS_INDIRECTOS', note: 'seguro obra/ART = CIP' },
  { id: 'CIP-transp-01', kind: 'core', industry: 'Empresa de transporte y fletes', text: facCompra('Sancor Seguros', 'seguro automotor de flota\nVTV de camiones'), expected: 'COSTOS_INDIRECTOS', note: 'seguro flota/VTV = CIP' },
  { id: 'CIP-transp-02', kind: 'core', industry: 'Empresa de transporte y fletes', text: facCompra('Monitoreo GPS SA', 'servicio de rastreo GPS y monitoreo de flota'), expected: 'COSTOS_INDIRECTOS', note: 'monitoreo flota = CIP' },
  { id: 'CIP-salud-01', kind: 'core', industry: 'Clínica / salud', text: facCompra('BioTécnica SA', 'mantenimiento y calibración de equipo médico'), expected: 'COSTOS_INDIRECTOS', note: 'calibración equipo médico = CIP' },
  { id: 'CIP-agro-01', kind: 'core', industry: 'Productora agropecuaria de soja', text: facCompra('Transportes Rurales SA', 'flete y transporte de la cosecha al acopio'), expected: 'COSTOS_INDIRECTOS', note: 'flete cosecha = CIP' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE — VENTAS (factura emitida / remito de salida)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'VTA-manuf-01', kind: 'core', industry: 'Fábrica metalúrgica / manufactura', text: facVenta('200 piezas mecanizadas despachadas al cliente'), expected: 'VENTAS', note: 'factura de venta = VENTAS' },
  { id: 'VTA-gastro-01', kind: 'core', industry: 'Panadería / gastronomía', text: facVenta('venta de 500 kg de pan al cliente'), expected: 'VENTAS', note: 'factura de venta = VENTAS' },
  { id: 'VTA-textil-01', kind: 'core', industry: 'Taller textil de indumentaria', text: facVenta('100 remeras vendidas al cliente mayorista'), expected: 'VENTAS', note: 'factura de venta = VENTAS' },
  { id: 'VTA-agro-01', kind: 'core', industry: 'Productora agropecuaria de soja', text: facVenta('venta a cliente de 50 toneladas de soja'), expected: 'VENTAS', note: 'venta a cliente aunque mencione soja (MP) → VENTAS' },
  { id: 'VTA-remito-01', kind: 'core', industry: 'Fábrica metalúrgica / manufactura', text: 'REMITO\nDespachamos 200 cajas de producto terminado al cliente\nSalida de mercadería del depósito\nTransportista: Fletes SA', expected: 'VENTAS', note: 'remito de salida/despacho = VENTAS' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE — NOTAS y REMITOS de entrada
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'ND-01', kind: 'core', industry: 'Fábrica metalúrgica / manufactura', text: 'NOTA DE DÉBITO A\nCAE Nº: 76000000000001\nCUIT 30-12345678-9\nAjuste por diferencia de precio de proveedor', expected: 'COSTOS_INDIRECTOS', note: 'nota de débito → CIP (regla layer4)' },
  { id: 'NC-01', kind: 'core', industry: 'Fábrica metalúrgica / manufactura', text: 'NOTA DE CRÉDITO B\nCAE Nº: 76000000000002\nCUIT 30-12345678-9\nDevolución parcial de mercadería', expected: 'COSTOS_INDIRECTOS', note: 'nota de crédito → CIP (regla layer4)' },
  { id: 'REM-in-01', kind: 'core', industry: 'Fábrica metalúrgica / manufactura', text: 'REMITO\nRecibimos 500 kg de acero del proveedor\nEntrada a depósito de materia prima\nFecha de entrega: 10/06/2026', expected: 'MATERIA_PRIMA', note: 'remito de entrada/compra = MP' },

  // ═══════════════════════════════════════════════════════════════════════════
  // GAP — Divergencias CONOCIDAS cátedra vs. sistema (NO cuentan en la métrica)
  // ═══════════════════════════════════════════════════════════════════════════
  // La cátedra: hilo en una remera es MP INDIRECTA → CIP. El sistema lo toma
  // como MP directa por keyword. Debatible (el hilo puede ser insumo principal).
  { id: 'GAP-mp-indirecta', kind: 'gap', industry: 'Taller textil de indumentaria', text: facCompra('Mercería Central', 'hilo de coser para terminación de remeras'), expected: 'COSTOS_INDIRECTOS', note: 'MP indirecta (hilo) → CIP por cátedra; sistema da MP' },
  // MO INDIRECTA: capataz / gerente de producción NO transforma la MP → es CIP,
  // no MOD. El sistema ve "RECIBO DE SUELDO" y lo manda a MANO_DE_OBRA.
  { id: 'GAP-mo-indirecta', kind: 'gap', industry: 'Fábrica metalúrgica / manufactura', text: recibo('Empleado: capataz de planta (supervisión)'), expected: 'COSTOS_INDIRECTOS', note: 'MO indirecta (capataz) → CIP por cátedra; sistema da MOD' },
  // GASTO de administración: NO es costo de producción (no hay sección GASTOS).
  { id: 'GAP-gasto-admin-1', kind: 'gap', industry: 'Fábrica metalúrgica / manufactura', text: facCompra('Estudio Contable López', 'honorarios profesionales por confección de balance'), expected: 'DESCONOCIDO', note: 'gasto de administración → debería escalar / categoría GASTOS' },
  { id: 'GAP-gasto-admin-2', kind: 'gap', industry: 'Fábrica metalúrgica / manufactura', text: recibo('Empleado: gerente administrativo'), expected: 'DESCONOCIDO', note: 'sueldo admin = GASTO, no MOD; sistema da MOD' },
  // GASTO de comercialización: publicidad, comisiones de venta.
  { id: 'GAP-gasto-comercial-1', kind: 'gap', industry: 'Fábrica metalúrgica / manufactura', text: facCompra('Agencia Publicidad SA', 'servicio de publicidad y marketing de la marca'), expected: 'DESCONOCIDO', note: 'gasto de comercialización → no es costo de producción' },
  // GASTO financiero: intereses de préstamo bancario.
  { id: 'GAP-gasto-financiero-1', kind: 'gap', industry: 'Fábrica metalúrgica / manufactura', text: 'NOTA DE DÉBITO A\nCAE Nº: 76000000000003\nCUIT 30-12345678-9\nIntereses por préstamo bancario', expected: 'DESCONOCIDO', note: 'gasto financiero → no es costo; sistema lo manda a CIP' },
  // ROBUSTEZ: colisión de substring. "hormigonERA" (máquina, CIP) matchea el
  // keyword "hormigón" (material, MP) → falsa ambigüedad, escala. Fix propuesto:
  // matching por límite de palabra en los keywords de perfil.
  { id: 'GAP-substr-hormigonera', kind: 'gap', industry: 'Empresa constructora de obras', text: facCompra('Alquiler de Equipos Viales SA', 'alquiler de hormigonera para la obra'), expected: 'COSTOS_INDIRECTOS', note: 'colisión substring hormigonera↔hormigón → escala en vez de CIP' },
  // ROBUSTEZ: categorizeIndustry es sensible a acentos. "gastronómica" (con ó)
  // no matchea el patrón "gastronom" → cae a COMERCIO. Fix propuesto: normalizar
  // acentos antes de testear los patrones de rubro.
  { id: 'GAP-acento-rubro', kind: 'gap', industry: 'Cocina gastronómica', text: facCompra('Mercado Central SA', 'cajones de verdura, fruta y tomate'), expected: 'MATERIA_PRIMA', note: 'acento en rubro esquiva el regex → rubro mal detectado' },
];

const LABEL: Record<string, string> = {
  MATERIA_PRIMA: 'MP', MANO_DE_OBRA: 'MOD', COSTOS_INDIRECTOS: 'CIP',
  VENTAS: 'VTA', MULTIPLE: 'MULTI', DESCONOCIDO: '???',
  GASTO_COMERCIALIZACION: 'G-COM', GASTO_ADMINISTRACION: 'G-ADM', GASTO_FINANCIERO: 'G-FIN',
};

describe('Efectividad de clasificación vs. criterios cátedra (Mirta)', () => {
  it('CORE: mide accuracy por sección y total', async () => {
    const core = CASES.filter((c) => c.kind === 'core');
    const bySection: Record<string, { ok: number; total: number }> = {};
    let correct = 0;
    let autoClassified = 0;
    const misses: { c: Case; got: string; expl: string }[] = [];
    const rows: string[] = [];
    rows.push('ID'.padEnd(16) + 'ESP'.padEnd(6) + 'OBT'.padEnd(6) + 'CONF'.padEnd(6) + 'REVIEW'.padEnd(8) + 'R');

    for (const c of core) {
      const r = await classifyDocument({ ...BASE, text: c.text, industry: c.industry, groqQuality: 'legible' });
      const ok = r.costSection === c.expected;
      const sec = LABEL[c.expected];
      bySection[sec] ??= { ok: 0, total: 0 };
      bySection[sec].total++;
      if (ok) { correct++; bySection[sec].ok++; }
      if (!r.requiresReview) autoClassified++;
      if (!ok) misses.push({ c, got: LABEL[r.costSection], expl: r.explanation });
      rows.push(
        c.id.padEnd(16) + sec.padEnd(6) + LABEL[r.costSection].padEnd(6) +
        String(r.confidence).padEnd(6) + (r.requiresReview ? 'sí' : 'no').padEnd(8) + (ok ? 'OK' : 'XX'),
      );
    }

    const acc = (correct / core.length) * 100;
    const auto = (autoClassified / core.length) * 100;
    // eslint-disable-next-line no-console
    console.log('\n' + rows.join('\n'));
    // eslint-disable-next-line no-console
    console.log('\n── Accuracy por sección ──');
    for (const [sec, s] of Object.entries(bySection)) {
      // eslint-disable-next-line no-console
      console.log(`  ${sec.padEnd(5)} ${s.ok}/${s.total} (${((s.ok / s.total) * 100).toFixed(0)}%)`);
    }
    // eslint-disable-next-line no-console
    console.log(`\n==> CORE ACCURACY: ${correct}/${core.length} = ${acc.toFixed(1)}%  |  auto-clasificados: ${auto.toFixed(1)}%`);
    if (misses.length) {
      // eslint-disable-next-line no-console
      console.log('\nFALLOS CORE:');
      for (const m of misses) console.log(`  - ${m.c.id}: esperado ${LABEL[m.c.expected]}, dio ${m.got}\n      ${m.expl}`);
    }
    console.log('');

    // Objetivo del equipo: ≥90% en casos operativos normales.
    expect(acc).toBeGreaterThanOrEqual(90);
  });

  // Timeout holgado: es informativo y sin DB local cada caso que escala hace un
  // round-trip a Prisma (getCorrectionExamples) que reintenta contra el server
  // ausente antes de fallar gracefully. En CI (con DB) es instantáneo.
  it('GAP: reporta divergencias conocidas cátedra vs. sistema (informativo)', async () => {
    const gaps = CASES.filter((c) => c.kind === 'gap');
    const rows: string[] = [];
    rows.push('ID'.padEnd(24) + 'CÁTEDRA'.padEnd(9) + 'SISTEMA'.padEnd(9) + 'ESCALA'.padEnd(8) + 'ESTADO');
    for (const c of gaps) {
      const r = await classifyDocument({ ...BASE, text: c.text, industry: c.industry, groqQuality: 'legible' });
      // "seguro" = escala a revisión humana (no es error silencioso).
      // "diverge" = auto-clasifica distinto a la cátedra (a revisar por el equipo).
      const state = c.expected === 'DESCONOCIDO'
        ? (r.requiresReview ? 'escala-OK' : `diverge→${LABEL[r.costSection]}`)
        : (r.costSection === c.expected ? 'coincide' : `diverge→${LABEL[r.costSection]}`);
      rows.push(
        c.id.padEnd(24) + LABEL[c.expected].padEnd(9) + LABEL[r.costSection].padEnd(9) +
        (r.requiresReview ? 'sí' : 'no').padEnd(8) + state,
      );
    }
    // eslint-disable-next-line no-console
    console.log('\n── GAP (divergencias conocidas, no cuentan en la métrica) ──\n' + rows.join('\n') + '\n');
  }, 30000);
});
