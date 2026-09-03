import type { Prisma } from '@prisma/client';
import { evaluarRegla, type ReglaAlerta } from '../../domain/alertas/reglas-alerta.js';
import {
  calcularVariacionPuntoEquilibrio,
  type PuntoEquilibrio,
} from '../../domain/calculations/punto-equilibrio.js';
import { resolverParametro, type FilaParametro } from '../../domain/parametros/parametros-costeo.js';

export const INDICADOR_VARIACION_PUNTO_EQUILIBRIO = 'variacion_punto_equilibrio_pct';
export const PARAMETRO_UMBRAL_VARIACION_PUNTO_EQUILIBRIO = 'umbral_variacion_punto_equilibrio_pct';

type ResultadosConPuntoEquilibrio = { puntoEquilibrio?: PuntoEquilibrio };

function puntoEquilibrioDe(results: unknown): PuntoEquilibrio | null {
  const punto = (results as ResultadosConPuntoEquilibrio | null)?.puntoEquilibrio;
  if (!punto || typeof punto !== 'object' || typeof punto.incompleta !== 'boolean') return null;
  if (punto.unidadesEquilibrio !== null && typeof punto.unidadesEquilibrio !== 'number') return null;
  return punto;
}

/**
 * Conecta la vista persistida de punto de equilibrio con la regla ya existente.
 * No agrega un motor de alertas: solo produce una lectura del indicador y deja
 * que `evaluarRegla` determine si corresponde avisar.
 */
export class PuntoEquilibrioAlertService {
  async evaluar(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      companyId: string | null;
      structureId: string;
      periodId: string | null;
      runId: string;
      puntoEquilibrio: PuntoEquilibrio;
      fecha: Date;
    },
  ): Promise<void> {
    if (!params.companyId) return;

    const filas = await tx.parametroCosteo.findMany({
      where: {
        companyId: params.companyId,
        clave: PARAMETRO_UMBRAL_VARIACION_PUNTO_EQUILIBRIO,
        deletedAt: null,
      },
      select: { clave: true, valorNum: true, periodId: true, structureId: true, confirmado: true },
    });
    const umbral = resolverParametro(
      PARAMETRO_UMBRAL_VARIACION_PUNTO_EQUILIBRIO,
      filas.map(
        (fila): FilaParametro => ({
          clave: fila.clave,
          valorNum: fila.valorNum === null ? null : Number(fila.valorNum),
          periodId: fila.periodId,
          structureId: fila.structureId,
          confirmado: fila.confirmado,
        }),
      ),
      { structureId: params.structureId, periodId: params.periodId },
    ).valor;

    // La regla queda visible y editable por el mecanismo que ya existe. El
    // parámetro es la fuente del umbral por defecto, por eso se sincroniza al
    // recalcular sin introducir una constante de negocio en este servicio.
    const regla = await tx.reglaAlerta.upsert({
      where: {
        companyId_structureId_indicador: {
          companyId: params.companyId,
          structureId: params.structureId,
          indicador: INDICADOR_VARIACION_PUNTO_EQUILIBRIO,
        },
      },
      create: {
        companyId: params.companyId,
        userId: params.userId,
        structureId: params.structureId,
        indicador: INDICADOR_VARIACION_PUNTO_EQUILIBRIO,
        descripcion: 'Variación del punto de equilibrio',
        condicion: 'MAYOR',
        umbral,
        lecturasSostenidas: 1,
        severidad: 'ADVERTENCIA',
      },
      update: { umbral },
    });

    const anterior = await tx.calculationRun.findFirst({
      where: { structureId: params.structureId, id: { not: params.runId } },
      orderBy: { runN: 'desc' },
      select: { results: true },
    });
    const puntoAnterior = anterior ? puntoEquilibrioDe(anterior.results) : null;
    if (!puntoAnterior) return;

    const variacion = calcularVariacionPuntoEquilibrio(params.puntoEquilibrio, puntoAnterior);
    if (variacion === null) return;

    const reglaParaEvaluar: ReglaAlerta = {
      id: regla.id,
      indicador: regla.indicador,
      descripcion: regla.descripcion,
      condicion: regla.condicion,
      umbral: Number(regla.umbral),
      unidad: '%',
      lecturasSostenidas: regla.lecturasSostenidas,
      severidad: regla.severidad,
      activa: regla.activa,
    };
    const hallazgo = evaluarRegla(reglaParaEvaluar, [{ fecha: params.fecha, valor: variacion }]);
    if (!hallazgo) return;

    await tx.alert.create({
      data: {
        userId: params.userId,
        companyId: params.companyId,
        costStructureId: params.structureId,
        type: 'INDICADOR_FISICO',
        message: hallazgo.mensaje,
        threshold: hallazgo.umbral,
        actualValue: hallazgo.valor,
      },
    });
  }
}
