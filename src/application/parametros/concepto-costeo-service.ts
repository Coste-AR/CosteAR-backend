import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import {
  resolverConceptoCosteo,
  violaCausalidadDeVolumen,
  type FilaConceptoCosteo,
  type ElementoConcepto,
} from '../../domain/parametros/concepto-costeo.js';
import type {
  CrearConceptoCosteoInput,
  ActualizarConceptoCosteoInput,
} from '../../shared/schemas/concepto-costeo.schema.js';

/**
 * CONCEPTOS DE COSTEO (M1-01, plan de análisis marginal v2).
 *
 * El cable de escritura/lectura de `ConceptoCosteo`: clasificación de costos
 * por debajo de los tres baldes de `ParametroCosteo`. Mismas reglas de
 * trazabilidad que el resto del catálogo — DOM-01 (borrado lógico), DOM-02
 * (bitácora en la misma transacción), DOM-03 (timestamps del servidor),
 * DOM-07 (aislamiento por RLS vía `withTenant`).
 *
 * 🔴 Esta capa NO conecta los conceptos al motor de cálculo — eso queda
 * fuera de alcance de M1-01 a propósito (ver ADR 0021). Hoy solo clasifica y
 * guarda: leer/escribir `ConceptoCosteo` no cambia ningún número del
 * tablero.
 */
export class ConceptoCosteoService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async companyDe(userId: string, companyId: string) {
    const company = await this.db.company.findFirst({ where: { id: companyId, userId } });
    if (!company) throw new NotFoundError('Negocio no encontrado');
    return company;
  }

  /**
   * Sin este chequeo, alguien podría leer o escribir un concepto "de" una
   * estructura o un período ajenos solo adivinando su id (mismo criterio que
   * `ParametrosCosteoService.validarAlcance`).
   */
  private async validarAlcance(
    companyId: string,
    ctx: { structureId?: string | null; periodId?: string | null },
  ): Promise<void> {
    if (ctx.structureId) {
      const est = await this.db.costStructure.findFirst({ where: { id: ctx.structureId, companyId } });
      if (!est) throw new NotFoundError('Estructura de costos no encontrada');
    }
    if (ctx.periodId) {
      const per = await this.db.costPeriod.findFirst({ where: { id: ctx.periodId, companyId } });
      if (!per) throw new NotFoundError('Período no encontrado');
    }
  }

  private aFila(c: {
    id: string; clave: string; descripcion: string | null; elemento: string;
    comportamientoVolumen: string | null; causaVariabilidad: string | null;
    erogable: boolean | null; horizonteErogableMeses: number | null; evitable: boolean | null;
    nivelSegmentacion: string | null; segmentoId: string | null;
    rangoActividadDesde: Prisma.Decimal | null; rangoActividadHasta: Prisma.Decimal | null;
    periodId: string | null; structureId: string | null; confirmado: boolean;
    clasificadoPorUserId: string | null; clasificadoEn: Date | null;
  }): FilaConceptoCosteo {
    return {
      ...c,
      elemento: c.elemento as ElementoConcepto,
      comportamientoVolumen: c.comportamientoVolumen as FilaConceptoCosteo['comportamientoVolumen'],
      causaVariabilidad: c.causaVariabilidad as FilaConceptoCosteo['causaVariabilidad'],
      rangoActividadDesde: c.rangoActividadDesde === null ? null : Number(c.rangoActividadDesde),
      rangoActividadHasta: c.rangoActividadHasta === null ? null : Number(c.rangoActividadHasta),
    };
  }

  /** Todas las filas cargadas de una empresa, listas para `resolverConceptoCosteo`. */
  private async filasDe(companyId: string, elemento?: ElementoConcepto): Promise<FilaConceptoCosteo[]> {
    const filas = await this.db.conceptoCosteo.findMany({
      where: { companyId, deletedAt: null, ...(elemento ? { elemento } : {}) },
    });
    return filas.map((f) => this.aFila(f));
  }

  /**
   * Todos los conceptos de la empresa, resueltos por cascada (uno por clave
   * distinta), opcionalmente filtrados por elemento.
   */
  async listar(
    userId: string,
    companyId: string,
    ctx: { structureId?: string | null; periodId?: string | null; elemento?: ElementoConcepto } = {},
  ) {
    await this.companyDe(userId, companyId);
    await this.validarAlcance(companyId, ctx);
    const filas = await this.filasDe(companyId, ctx.elemento);
    const claves = [...new Set(filas.map((f) => f.clave))];
    return claves
      .map((clave) => resolverConceptoCosteo(clave, filas, ctx))
      .filter((r) => r !== null);
  }

  /** Crea un concepto nuevo en el nivel indicado (empresa por default). */
  async crear(userId: string, companyId: string, input: CrearConceptoCosteoInput, actor: TraceActor) {
    await this.companyDe(userId, companyId);
    const structureId = input.structureId ?? null;
    const periodId = input.periodId ?? null;
    await this.validarAlcance(companyId, { structureId, periodId });

    if (violaCausalidadDeVolumen(input.comportamientoVolumen, input.causaVariabilidad)) {
      throw new UnprocessableEntityError(
        `El concepto "${input.clave}" no puede ser VARIABLE con causa "${input.causaVariabilidad}": ` +
        'R4 define fijo/variable por CAUSALIDAD, y solo la causa "volumen" justifica variable. ' +
        'R8: ningún costo fijo entra al costo variable por vía de una cuota de aplicación.',
        { field: 'causaVariabilidad' },
      );
    }

    return withTenant(userId, async (tx) => {
      const existente = await tx.conceptoCosteo.findFirst({
        where: { companyId, structureId, periodId, clave: input.clave, deletedAt: null },
      });
      if (existente) {
        throw new UnprocessableEntityError(
          `Ya existe un concepto "${input.clave}" en este nivel. Usá actualizar en vez de crear.`,
          { field: 'clave' },
        );
      }

      const data: Prisma.ConceptoCosteoUncheckedCreateInput = {
        companyId,
        userId,
        structureId,
        periodId,
        clave: input.clave,
        descripcion: input.descripcion ?? null,
        elemento: input.elemento,
        comportamientoVolumen: input.comportamientoVolumen ?? null,
        causaVariabilidad: input.causaVariabilidad ?? null,
        erogable: input.erogable ?? null,
        horizonteErogableMeses: input.horizonteErogableMeses ?? null,
        evitable: input.evitable ?? null,
        nivelSegmentacion: input.nivelSegmentacion ?? null,
        segmentoId: input.segmentoId ?? null,
        rangoActividadDesde: input.rangoActividadDesde ?? null,
        rangoActividadHasta: input.rangoActividadHasta ?? null,
        confirmado: input.confirmado,
        // Proponer no es confirmar: crear un concepto es siempre una
        // declaración explícita de quien llama, así que siempre deja autor y
        // reloj del servidor — a diferencia de ParametroCosteo, acá no hay
        // semilla del sistema.
        clasificadoPorUserId: actor.id,
        clasificadoEn: new Date(),
      };

      const guardado = await tx.conceptoCosteo.create({ data });

      await recordTraceAudit(
        {
          entityType: 'ConceptoCosteo',
          entityId: guardado.id,
          action: 'create',
          actor,
          after: guardado,
          comment: `Concepto "${input.clave}" (${input.elemento}) creado ${input.confirmado ? 'confirmado' : 'sin confirmar'}.`,
        },
        tx,
      );

      return this.aFila(guardado);
    });
  }

  /** Actualiza la clasificación de un concepto existente. */
  async actualizar(
    userId: string,
    companyId: string,
    id: string,
    input: ActualizarConceptoCosteoInput,
    actor: TraceActor,
  ) {
    await this.companyDe(userId, companyId);

    return withTenant(userId, async (tx) => {
      const existente = await tx.conceptoCosteo.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!existente) throw new NotFoundError('Concepto de costeo no encontrado');

      const comportamientoVolumen = input.comportamientoVolumen !== undefined
        ? input.comportamientoVolumen
        : (existente.comportamientoVolumen as FilaConceptoCosteo['comportamientoVolumen']);
      const causaVariabilidad = input.causaVariabilidad !== undefined
        ? input.causaVariabilidad
        : (existente.causaVariabilidad as FilaConceptoCosteo['causaVariabilidad']);
      if (violaCausalidadDeVolumen(comportamientoVolumen, causaVariabilidad)) {
        throw new UnprocessableEntityError(
          `El concepto "${existente.clave}" no puede ser VARIABLE con causa "${causaVariabilidad}": ` +
          'R4 define fijo/variable por CAUSALIDAD, y solo la causa "volumen" justifica variable. ' +
          'R8: ningún costo fijo entra al costo variable por vía de una cuota de aplicación.',
          { field: 'causaVariabilidad' },
        );
      }

      const data: Prisma.ConceptoCosteoUncheckedUpdateInput = {
        ...(input.descripcion !== undefined ? { descripcion: input.descripcion } : {}),
        ...(input.elemento !== undefined ? { elemento: input.elemento } : {}),
        ...(input.comportamientoVolumen !== undefined ? { comportamientoVolumen: input.comportamientoVolumen } : {}),
        ...(input.causaVariabilidad !== undefined ? { causaVariabilidad: input.causaVariabilidad } : {}),
        ...(input.erogable !== undefined ? { erogable: input.erogable } : {}),
        ...(input.horizonteErogableMeses !== undefined ? { horizonteErogableMeses: input.horizonteErogableMeses } : {}),
        ...(input.evitable !== undefined ? { evitable: input.evitable } : {}),
        ...(input.nivelSegmentacion !== undefined ? { nivelSegmentacion: input.nivelSegmentacion } : {}),
        ...(input.segmentoId !== undefined ? { segmentoId: input.segmentoId } : {}),
        ...(input.rangoActividadDesde !== undefined ? { rangoActividadDesde: input.rangoActividadDesde } : {}),
        ...(input.rangoActividadHasta !== undefined ? { rangoActividadHasta: input.rangoActividadHasta } : {}),
        confirmado: input.confirmado,
        clasificadoPorUserId: actor.id,
        clasificadoEn: new Date(),
      };

      const guardado = await tx.conceptoCosteo.update({ where: { id }, data });

      await recordTraceAudit(
        {
          entityType: 'ConceptoCosteo',
          entityId: guardado.id,
          action: 'update',
          actor,
          before: existente,
          after: guardado,
          comment: `Concepto "${existente.clave}" ${input.confirmado ? 'confirmado' : 'actualizado sin confirmar'}.`,
        },
        tx,
      );

      return this.aFila(guardado);
    });
  }

  /** Borrado lógico (DOM-01): la ausencia hace que la cascada vuelva a caer en el balde. */
  async eliminar(userId: string, companyId: string, id: string, actor: TraceActor) {
    await this.companyDe(userId, companyId);

    await withTenant(userId, async (tx) => {
      const existente = await tx.conceptoCosteo.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!existente) throw new NotFoundError('Concepto de costeo no encontrado');

      const eliminado = await tx.conceptoCosteo.update({ where: { id }, data: { deletedAt: new Date() } });

      await recordTraceAudit(
        {
          entityType: 'ConceptoCosteo',
          entityId: id,
          action: 'delete',
          actor,
          before: existente,
          after: eliminado,
          comment: `Concepto "${existente.clave}" eliminado; ese elemento vuelve a resolverse por el balde de ParametroCosteo.`,
        },
        tx,
      );
    });
  }
}
