import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import type { TraceActor } from '../audit/trace-audit.js';
import { UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { CalculationRunService } from './calculation-run-service.js';
import { ProcessCalculationService } from './process-costing/process-calculation-service.js';

/**
 * EL CÁLCULO DIARIO DEL PERÍODO ABIERTO.
 *
 * Todos los días, para cada período abierto, el sistema recalcula con los datos
 * que hayan llegado y guarda la corrida entera. La corrida nace SIN VALIDAR: no
 * se le muestra al costista como resultado vigente, pero existe, y en
 * trazabilidad se ve toda la cadena día por día.
 *
 * Ojo con el nombre: esto NO calcula "el costo del martes". Calcula el período
 * abierto —el mes, la quincena, el ciclo de diez días— con la información
 * disponible hasta hoy. Es una foto diaria de un período en curso. La distinción
 * importa: "el costo del martes" exigiría saber cuántas unidades quedaron sin
 * terminar el martes, y ese dato lo informa la oficina técnica al cierre de cada
 * período, no todos los días.
 *
 * Tres reglas que gobiernan este servicio:
 *
 *  1. STANDBY. Si desde la última corrida automática no llegó ningún dato nuevo,
 *     no se calcula. El resultado sería idéntico y solo serviría para enterrar
 *     el historial bajo corridas iguales.
 *  2. AISLAMIENTO. Una estructura que falla no puede voltear el lote. El job
 *     recorre todos los períodos y reporta al final qué pasó con cada uno.
 *  3. NUNCA UN 500 A LA CARA DEL COSTISTA. Si faltan insumos, se registra el
 *     motivo en castellano y se sigue. Que falte un dato es un estado normal de
 *     un período en curso, no un error del sistema.
 */

/** Qué pasó con un período en la corrida de hoy. */
export interface DailyRunOutcome {
  periodId: string;
  periodLabel: string;
  structureId: string;
  productName: string;
  estado: 'calculado' | 'sin-cambios' | 'faltan-datos' | 'error';
  /** En castellano, para que lo lea el costista. Sin endpoints ni ids. */
  motivo?: string;
  runId?: string;
}

/** El actor de las corridas automáticas: el sistema, no una persona. */
function systemActor(ownerId: string): TraceActor {
  return {
    // La FK de `executedBy` exige un usuario real, así que va el dueño de la
    // estructura. El `area: 'sistema'` y el `trigger: AUTO_DAILY` son los que
    // dejan claro que no la apretó él.
    id: ownerId,
    role: 'COSTISTA',
    area: 'sistema',
    method: 'manual',
    device: 'cálculo automático diario',
  };
}

export class DailyRunService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly ordersCalc: CalculationRunService = new CalculationRunService(db),
    private readonly processCalc: ProcessCalculationService = new ProcessCalculationService(db),
  ) {}

  /**
   * Recorre todos los períodos abiertos y los recalcula. Devuelve el detalle de
   * cada uno — el worker lo loguea y sirve para saber si el job está haciendo
   * algo o girando en el vacío.
   */
  async runAll(): Promise<DailyRunOutcome[]> {
    const periods = await this.db.costPeriod.findMany({
      where: { status: 'OPEN', deletedAt: null },
      include: {
        structure: {
          select: { id: true, userId: true, productName: true, costingSystem: true, deletedAt: true },
        },
      },
    });

    const outcomes: DailyRunOutcome[] = [];

    for (const period of periods) {
      // Una estructura en la papelera no se calcula, pero su período abierto
      // puede seguir existiendo: no es un error, simplemente no hay nada que hacer.
      if (!period.structure || period.structure.deletedAt) continue;

      const base = {
        periodId: period.id,
        periodLabel: period.label,
        structureId: period.structure.id,
        productName: period.structure.productName,
      };

      try {
        outcomes.push({ ...base, ...(await this.runOne(period)) });
      } catch (err) {
        // AISLAMIENTO. Acá abajo no hay `throw`: si una estructura revienta por
        // una razón que no previmos, el resto del lote tiene que calcularse
        // igual. Perder treinta cálculos porque uno falló sería mucho peor que
        // el fallo original.
        console.error(`[daily-run] Error en el período ${period.id}:`, err);
        outcomes.push({
          ...base,
          estado: 'error',
          motivo: 'El cálculo automático falló por un error inesperado. Ya quedó registrado para revisión.',
        });
      }
    }

    return outcomes;
  }

  private async runOne(period: {
    id: string;
    lastAutoRunAt: Date | null;
    structure: { id: string; userId: string; costingSystem: string };
  }): Promise<Pick<DailyRunOutcome, 'estado' | 'motivo' | 'runId'>> {
    const structureId = period.structure.id;
    const userId = period.structure.userId;

    if (!(await this.hasNewData(structureId, period.id, period.lastAutoRunAt))) {
      return {
        estado: 'sin-cambios',
        motivo: 'No llegó ningún dato nuevo desde el último cálculo automático.',
      };
    }

    const actor = systemActor(userId);

    try {
      const result =
        period.structure.costingSystem === 'PROCESSES'
          ? await this.processCalc.calculate(userId, structureId, period.id, actor, 'AUTO_DAILY')
          : await this.ordersCalc.calculate(userId, structureId, actor, 'AUTO_DAILY');

      // La marca se mueve SOLO cuando hubo corrida. Si falló, mañana se
      // reintenta desde el mismo punto en vez de dar por visto un dato que
      // nunca se procesó.
      await this.db.costPeriod.update({
        where: { id: period.id },
        data: { lastAutoRunAt: new Date() },
      });

      return { estado: 'calculado', runId: result.run.id };
    } catch (err) {
      // Que falte un insumo NO es un error del sistema: es el estado normal de
      // un período que todavía se está armando. Se registra el motivo —que el
      // motor ya redacta en castellano y accionable— y el job sigue.
      //
      // Se atrapa `UnprocessableEntityError` entero y no solo `MissingInputError`
      // porque toda esa familia es lo mismo desde acá: el cuadro de movimiento
      // que todavía no cuadra, la base de asignación sin definir, el dato sin
      // imputar. Son todos 422 con mensaje para el costista, no fallas del
      // sistema, y tratarlos como "error" llenaría los logs de alarmas por
      // períodos que simplemente están a medio cargar.
      //
      // No se persiste una corrida vacía a propósito: sin insumos el motor no
      // produce números, y guardar una corrida sin resultados ensuciaría el
      // historial con filas que no dicen nada. Lo que falta se ve en el reporte
      // del job y en la pantalla del período.
      if (err instanceof UnprocessableEntityError) {
        return { estado: 'faltan-datos', motivo: err.message };
      }
      throw err;
    }
  }

  /**
   * EL STANDBY. ¿Pasó algo desde la última corrida automática?
   *
   * Sin marca previa (período recién abierto) la respuesta es siempre que sí: la
   * primera corrida no se saltea nunca.
   *
   * Se miran las cuatro puertas por las que entra información al cálculo:
   * documentos aprobados de la cola, guardados de configuración, el cuadro de
   * movimiento de unidades del período, y los datos trazables con sus
   * correcciones.
   */
  private async hasNewData(
    structureId: string,
    periodId: string,
    since: Date | null,
  ): Promise<boolean> {
    if (!since) return true;

    const [entries, configs, schedules, versions] = await Promise.all([
      this.db.dataEntry.count({
        where: { costStructureId: structureId, status: 'APPROVED', updatedAt: { gt: since } },
      }),
      this.db.costConfigVersion.count({ where: { structureId, createdAt: { gt: since } } }),
      this.db.unitMovementSchedule.count({ where: { periodId, updatedAt: { gt: since } } }),
      this.db.dataPointVersion.count({
        where: { dataPoint: { structureId }, createdAt: { gt: since } },
      }),
    ]);

    return entries + configs + schedules + versions > 0;
  }
}
