import type { GastoSubtype } from '../types.js';
import { TRANSVERSAL_GASTO_KEYWORDS } from '../industry/industry-profile.js';
import { matchKeywords } from '../utils/keyword-match.js';

export const SECTION_MARGIN = 2;

export const UNCONDITIONAL_CIP_KEYWORDS = [
  'fuerza motriz',
  'materiales indirectos', 'material indirecto',
  'reproceso', 'retrabajo',
  'energía de máquinas', 'energia de maquinas',
  'energía eléctrica de planta', 'energia electrica de planta',
  'energía eléctrica de máquinas', 'energia electrica de maquinas',
];

/**
 * Energía eléctrica SIN calificar el destino (planta vs. oficina).
 *
 * Va acá y NO en UNCONDITIONAL_CIP_KEYWORDS a propósito: la cátedra lista la
 * energía eléctrica como CIP (Clase 1, l. 64; Clase 11, l. 211) **cuando es de
 * producción**, y una factura de luz no dice de qué. Estas palabras puntúan como
 * una señal más de CIP, así que las señales de gasto de `scoreGasto` todavía
 * pueden ganarles o empatarles (y el empate escala a la IA). Las variantes que
 * SÍ declaran el destino productivo ('energía eléctrica de planta', 'energía de
 * máquinas', 'fuerza motriz') viven en la lista incondicional de arriba.
 *
 * ⚠️ LÍMITE CONOCIDO: estas keywords NO distinguen la luz de la planta de la luz
 * de la oficina administrativa. Una factura que solo diga "energía eléctrica —
 * oficina administrativa" cae en CIP, porque 'oficina administrativa' no es
 * ninguna señal de `TRANSVERSAL_GASTO_KEYWORDS` (las de administración son
 * frases específicas: honorarios, papelería, sueldos administrativos…). Ver
 * DECISIONES.md § CL-05.
 *
 * Cada término va con y sin tilde porque el matcheo compara en minúsculas pero
 * SIN plegar acentos (ver DECISIONES.md § CL-05 y `utils/keyword-match.ts`).
 */
export const ELECTRICITY_CIP_KEYWORDS = [
  'energía eléctrica', 'energia electrica',
  'electricidad',
  // 'luz eléctrica' la contempla desde siempre el regex `hasEnergy` de
  // layer4-invoice-routing, pero ese regex solo aporta una señal: sin la keyword
  // acá, una factura que dijera "Luz eléctrica de la planta" caía igual a la IA
  // (verificado: daba DESCONOCIDO / requiresAI true). 'Gas natural' se salvaba
  // de casualidad, porque 'gas' está en los cipKeywords del perfil DEFAULT.
  'luz eléctrica', 'luz electrica',
  'kwh',
];

export const UNIVERSAL_CIP_KEYWORDS = [
  'mantenimiento', 'reparación', 'reparacion', 'seguro', 'póliza', 'poliza',
  'alquiler', 'limpieza', 'vigilancia', 'seguridad', 'flete', 'logística',
  'logistica', 'amortización', 'amortizacion', 'depreciación', 'depreciacion',
  'telefonía', 'telefonia', 'internet', 'expensas', 'vtv', 'residuos',
  ...ELECTRICITY_CIP_KEYWORDS,
  ...UNCONDITIONAL_CIP_KEYWORDS,
];

export const ACQUISITION_INHERENT_KEYWORDS = [
  'flete', 'seguro', 'póliza', 'poliza', 'acarreo',
  'despachante', 'derechos aduaneros', 'gastos de aduana',
];

export const GASTO_LABELS: Record<GastoSubtype, string> = {
  GASTO_COMERCIALIZACION: 'Gasto de Comercialización',
  GASTO_ADMINISTRACION: 'Gasto de Administración',
  GASTO_FINANCIERO: 'Gasto Financiero',
};

export function scoreGasto(lower: string): { subtype: GastoSubtype; score: number; matched: string[] } {
  let best: { subtype: GastoSubtype; score: number; matched: string[] } = {
    subtype: 'GASTO_ADMINISTRACION',
    score: 0,
    matched: [],
  };
  for (const subtype of Object.keys(TRANSVERSAL_GASTO_KEYWORDS) as GastoSubtype[]) {
    const matched = matchKeywords(lower, TRANSVERSAL_GASTO_KEYWORDS[subtype]);
    if (matched.length > best.score) best = { subtype, score: matched.length, matched };
  }
  return best;
}
