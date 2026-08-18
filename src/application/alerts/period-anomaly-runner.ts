import { Prisma } from '@prisma/client';
import {
  detectAnomalies,
  type AnomalyFinding,
  type AnomalyPeriod,
  type AnomalyReport,
} from './anomaly-detection.js';
import type { FrozenCalculation } from '../../domain/calculations/calculate.js';

/**
 * ENCHUFE del detector de anomalías al cierre de período.
 *
 * Por qué existe
 * --------------
 * `anomaly-detection.ts` estaba terminado y testeado pero **sin un solo llamador de
 * producción**. Mientras tanto, `CostPeriodService.close()` tenía su propia detección
 * escrita a mano, con defectos que este módulo ya resolvía:
 *
 * | Detección ad-hoc que había          | Qué hace este módulo                        |
 * |-------------------------------------|---------------------------------------------|
 * | Comparaba TOTALES y el mensaje decía "costo unitario" | Compara lo que dice comparar |
 * | Umbral fijo del 10 %                | Umbrales configurables                       |
 * | Promediaba aunque hubiera 1 período | Exige un mínimo y explica cuando no llega    |
 * | Solo detectaba subas                | Detecta el desvío en los dos sentidos        |
 * | Dejaba `threshold` y `actualValue` en null | Los persiste: la alerta queda con su respaldo |
 * | Silencio = "todo bien"              | Reporta lo que NO pudo evaluar, y por qué    |
 *
 * Ese último punto es el que más importa: una pantalla que dice "todo tranquilo"
 * cuando en realidad no miró nada miente sobre su propia cobertura.
 */

/** Lo mínimo que este runner necesita de un período cerrado. */
export interface PeriodoCerrado {
  code: string;
  label: string;
  resultSnapshot: unknown;
  /**
   * Unidades PRODUCIDAS del período, si se conocen.
   *
   * Hoy el resultado congelado NO las trae: `CalculationOutput` no tiene unidades.
   * Mientras siga así se pasa `null`, y el detector **saltea** la señal de costo
   * unitario diciendo por qué, en lugar de dividir por lo que haya a mano.
   *
   * Queda habilitado para cuando `productionQuantity` llegue al motor (tarea S-02
   * del vertical avícola): ahí esta señal se enciende sola.
   */
  units?: number | null;
}

export interface ResultadoDeteccion {
  report: AnomalyReport;
  /** Filas listas para `tx.alert.createMany`. Vacío si no hay hallazgos. */
  alertas: Prisma.AlertCreateManyInput[];
}

/** `warn` y `critical` avisan; `info` queda en el reporte pero no genera alerta. */
const SEVERIDADES_QUE_ALERTAN = new Set<AnomalyFinding['severity']>(['warn', 'critical']);

function aAnomalyPeriod(p: PeriodoCerrado): AnomalyPeriod | null {
  // Un período sin resultado congelado no se puede comparar. No se inventa un cero:
  // un cero se promedia y ensucia la media de todos los demás.
  if (!p.resultSnapshot) return null;
  return {
    code: p.code,
    label: p.label,
    result: p.resultSnapshot as FrozenCalculation,
    units: p.units ?? null,
  };
}

/**
 * Corre el detector sobre un período recién cerrado y arma las filas de alerta.
 *
 * No escribe en la base: devuelve las filas para que el llamador las persista
 * **dentro de la misma transacción del cierre** (DOM-02).
 */
export function detectarAnomaliasDelCierre(params: {
  actual: PeriodoCerrado;
  /** Períodos cerrados anteriores, del MÁS NUEVO al más viejo. */
  historia: PeriodoCerrado[];
  userId: string;
  companyId: string | null;
  costStructureId: string | null;
}): ResultadoDeteccion {
  const actual = aAnomalyPeriod(params.actual);

  if (!actual) {
    return {
      report: {
        findings: [],
        skipped: [
          { signal: 'MIX_DEVIATION', reason: 'El período cerrado no tiene resultado congelado.' },
          { signal: 'UNIT_COST_JUMP', reason: 'El período cerrado no tiene resultado congelado.' },
          { signal: 'CIF_VARIANCE', reason: 'El período cerrado no tiene resultado congelado.' },
        ],
        periodsAvailable: 0,
        periodsRequired: 0,
      },
      alertas: [],
    };
  }

  const history = params.historia
    .map(aAnomalyPeriod)
    .filter((p): p is AnomalyPeriod => p !== null);

  const report = detectAnomalies({ current: actual, history });

  const alertas: Prisma.AlertCreateManyInput[] = report.findings
    .filter((f) => SEVERIDADES_QUE_ALERTAN.has(f.severity))
    .map((f) => ({
      userId: params.userId,
      companyId: params.companyId,
      costStructureId: params.costStructureId,
      type: 'COST_SPIKE' as const,
      // El mensaje viene del detector, ya redactado en castellano para el costista.
      // Se le antepone el período para que la alerta se entienda fuera de contexto.
      message: `[${params.actual.label}] ${f.message}`,
      // Estas dos columnas existían en el modelo y la detección ad-hoc las dejaba
      // en null. Sin ellas la alerta es una afirmación sin respaldo.
      threshold: f.baseline !== null ? new Prisma.Decimal(f.baseline.toFixed(4)) : null,
      actualValue: new Prisma.Decimal(f.actual.toFixed(4)),
    }));

  return { report, alertas };
}
