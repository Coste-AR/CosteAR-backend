/**
 * Catálogo de cargas sociales inciertas — conocimiento del sistema (D-2).
 *
 * Fuente: cátedra de Costos (UNT), clase 8 — "Mano de obra: remuneración,
 * cargas sociales e índice de ausentismo".
 *
 * Regla de la cátedra: de las cargas INCIERTAS, solo las REMUNERATIVAS generan
 * cargas derivadas. Los conceptos que las generan son el IAP/YAP (ausentismo
 * pago — lo calcula el motor), el Premio por Asistencia Perfecta (PAP) y el
 * Premio por Productividad (PPP). El resto de las inciertas (uniformes, viandas,
 * medicamentos…) son NO remunerativas: suman al índice pero no generan nada encima.
 *
 * Este catálogo es la FUENTE DE VERDAD de la clasificación: la IA extrae los
 * conceptos del documento, pero NO decide en qué lista van. Clasificar mal
 * DESVÍA EL COSTO (una no remunerativa puesta como remunerativa infla el ITCS
 * con derivadas que no corresponden).
 *
 * Espejo del catálogo del frontend (`social-charges-catalog.ts` en
 * cost-structures). Si se cambia uno, cambiar el otro.
 */

export type SocialChargeKind = 'remunerative' | 'nonRemunerative';

export interface SocialChargeCatalogItem {
  /** Nombre canónico. */
  name: string;
  kind: SocialChargeKind;
  /** Sinónimos para reconocer lo que trae el documento (minúsculas, sin acentos). */
  aliases: string[];
}

export const SOCIAL_CHARGES_CATALOG: SocialChargeCatalogItem[] = [
  // ── Inciertas REMUNERATIVAS (generan cargas derivadas) ───────────────────
  {
    name: 'PAP (Premio Asistencia Perfecta)',
    kind: 'remunerative',
    aliases: ['papa', 'premio asistencia', 'asistencia perfecta', 'presentismo'],
  },
  {
    name: 'PPP (Premio por Productividad)',
    kind: 'remunerative',
    aliases: ['premio productividad', 'premio por productividad', 'productividad'],
  },
  { name: 'Antigüedad', kind: 'remunerative', aliases: ['antiguedad'] },
  {
    name: 'Gratificaciones habituales',
    kind: 'remunerative',
    aliases: ['gratificacion', 'gratificaciones'],
  },
  { name: 'Comisiones', kind: 'remunerative', aliases: ['comision', 'comisiones'] },
  {
    name: 'Horas extras',
    kind: 'remunerative',
    aliases: ['horas extra', 'horas extras', 'suplementarias'],
  },
  { name: 'Propinas habituales', kind: 'remunerative', aliases: ['propina', 'propinas'] },
  {
    name: 'Salarios en especie',
    kind: 'remunerative',
    aliases: ['en especie', 'remuneracion en especie', 'salario en especie'],
  },

  // ── Inciertas NO REMUNERATIVAS (no generan derivadas) ────────────────────
  {
    name: 'Uniformes / ropa de trabajo',
    kind: 'nonRemunerative',
    aliases: ['uniforme', 'uniformes', 'ropa de trabajo', 'indumentaria'],
  },
  {
    name: 'Almuerzos / viandas',
    kind: 'nonRemunerative',
    aliases: ['almuerzo', 'almuerzos', 'vianda', 'viandas', 'comedor', 'vales de almuerzo'],
  },
  {
    name: 'Reintegro de guardería',
    kind: 'nonRemunerative',
    aliases: ['guarderia', 'jardin maternal'],
  },
  {
    name: 'Gastos de medicamentos',
    kind: 'nonRemunerative',
    aliases: ['medicamento', 'medicamentos', 'farmacia'],
  },
  { name: 'Útiles escolares', kind: 'nonRemunerative', aliases: ['utiles escolares', 'utiles'] },
  {
    name: 'Cursos y seminarios',
    kind: 'nonRemunerative',
    aliases: ['curso', 'cursos', 'seminario', 'seminarios', 'capacitacion'],
  },
  { name: 'Gastos de sepelio', kind: 'nonRemunerative', aliases: ['sepelio', 'sepelios'] },
  { name: 'Casa habitación', kind: 'nonRemunerative', aliases: ['casa habitacion', 'vivienda'] },
  {
    name: 'Viáticos con comprobante',
    kind: 'nonRemunerative',
    aliases: ['viatico', 'viaticos'],
  },
  {
    name: 'Asignaciones familiares',
    kind: 'nonRemunerative',
    aliases: ['asignacion familiar', 'asignaciones familiares'],
  },
  {
    name: 'Automóvil afectado al trabajo',
    kind: 'nonRemunerative',
    aliases: ['automovil', 'vehiculo afectado'],
  },
];

/** Normaliza para comparar: sin acentos, en minúsculas, sin espacios de más. */
export function normalizeChargeName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Clasifica un concepto con el conocimiento del sistema.
 * Devuelve `null` si NO lo reconoce: en ese caso decide el costista.
 */
export function classifySocialCharge(name: string): SocialChargeKind | null {
  const n = normalizeChargeName(name);
  if (!n) return null;
  for (const item of SOCIAL_CHARGES_CATALOG) {
    if (normalizeChargeName(item.name) === n) return item.kind;
    // Alias de 4+ caracteres para evitar falsos positivos.
    if (item.aliases.some((a) => a.length >= 4 && n.includes(normalizeChargeName(a)))) {
      return item.kind;
    }
  }
  return null;
}
