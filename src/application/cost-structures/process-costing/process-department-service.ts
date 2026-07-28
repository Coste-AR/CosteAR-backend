import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma, withTenant } from '../../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../../audit/trace-audit.js';
import { NotFoundError, UnprocessableEntityError } from '../../../domain/errors/domain-error.js';

/**
 * COSTEO POR PROCESOS · DEPARTAMENTOS COMO SERVICIO (B14)
 *
 * Un departamento es una etapa del proceso productivo. Lo que los ordena no es
 * una preferencia de pantalla: `sequence` ES la cadena por la que viaja el
 * costo. El departamento 1 transfiere su costo al 2, el 2 al 3, y el costo
 * unitario del último es el costo del producto terminado. Por eso la cadena
 * tiene que ser SIEMPRE continua (1, 2, 3…) y por eso reordenarla o sacarle una
 * etapa después de haber calculado cambiaría el significado de resultados ya
 * emitidos.
 *
 * Reglas duras:
 *   · Solo estructuras `PROCESSES` (una de Órdenes recibe un 422 accionable).
 *   · Alta siempre AL FINAL de la cadena: nunca en el medio. Insertar una etapa
 *     entre dos existentes recorre el costo de todas las siguientes, así que si
 *     hace falta, se agrega y se reordena — de forma explícita.
 *   · Con cálculos ya hechos, la cadena queda CONGELADA: no se reordena ni se
 *     borra. Agregar al final sí se permite: no toca lo que ya se calculó.
 *   · Baja LÓGICA (`deletedAt`), como el resto del sistema: los cuadros de
 *     movimiento y los repartos de esa etapa no se pierden.
 *
 * Todo lo que muta corre en UNA transacción (`withTenant`, que setea el tenant
 * para RLS) y deja su auditoría en esa misma transacción.
 */

export interface ProcessDepartmentInputBody {
  name: string;
  /** true = MOD y CIP comparten avance ⇒ una sola columna "Conversión". */
  conversionUnified?: boolean;
}

interface DepartmentRow {
  id: string;
  name: string;
  sequence: number;
  defaultConversionAvanceEqualsMO: boolean;
}

export class ProcessDepartmentService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** Los departamentos de la estructura, en el orden en que ocurren. */
  async list(userId: string, structureId: string) {
    await this.requireProcessStructure(userId, structureId);
    const departments = await this.db.processDepartment.findMany({
      where: { structureId, deletedAt: null },
      orderBy: { sequence: 'asc' },
    });
    const chainFrozen = await this.hasRuns(structureId);
    return {
      departments: departments.map((d) => this.serialize(d)),
      /**
       * La cadena ya no se puede reordenar ni recortar (hay cálculos hechos).
       * El frontend lo usa para deshabilitar los controles ANTES de que el
       * usuario intente y se coma un error.
       */
      chainFrozen,
    };
  }

  /** Agrega una etapa AL FINAL de la cadena. */
  async create(
    userId: string,
    structureId: string,
    body: ProcessDepartmentInputBody,
    actor: TraceActor,
  ) {
    const structure = await this.requireProcessStructure(userId, structureId);
    const name = this.requireName(body.name);
    await this.requireNameLibre(structureId, name, null);

    return withTenant(userId, async (tx) => {
      // La secuencia se calcula sobre TODAS las filas (incluidas las dadas de
      // baja): el índice único `(structureId, sequence)` no distingue borrados.
      const ultimo = await tx.processDepartment.findFirst({
        where: { structureId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });

      const created = await tx.processDepartment.create({
        data: {
          structureId,
          name,
          sequence: Math.max(ultimo?.sequence ?? 0, 0) + 1,
          defaultConversionAvanceEqualsMO: body.conversionUnified ?? true,
        },
      });

      await recordTraceAudit(
        {
          entityType: 'ProcessDepartment',
          entityId: created.id,
          action: 'crear',
          actor,
          after: { estructura: structure.productName, ...this.serialize(created) },
        },
        tx,
      );

      return this.serialize(created);
    });
  }

  /** Renombra la etapa o cambia cómo sigue la conversión. No toca la cadena. */
  async update(
    userId: string,
    structureId: string,
    deptId: string,
    body: Partial<ProcessDepartmentInputBody>,
    actor: TraceActor,
  ) {
    await this.requireProcessStructure(userId, structureId);
    const actual = await this.requireDepartment(structureId, deptId);

    const name = body.name === undefined ? actual.name : this.requireName(body.name);
    if (name !== actual.name) await this.requireNameLibre(structureId, name, deptId);

    return withTenant(userId, async (tx) => {
      const updated = await tx.processDepartment.update({
        where: { id: deptId },
        data: {
          name,
          defaultConversionAvanceEqualsMO:
            body.conversionUnified ?? actual.defaultConversionAvanceEqualsMO,
        },
      });

      await recordTraceAudit(
        {
          entityType: 'ProcessDepartment',
          entityId: deptId,
          action: 'actualizar',
          actor,
          before: this.serialize(actual),
          after: this.serialize(updated),
        },
        tx,
      );

      return this.serialize(updated);
    });
  }

  /**
   * Da de baja una etapa y cierra el hueco que deja en la cadena.
   *
   * La fila borrada se manda a una secuencia negativa (siempre por debajo del
   * mínimo) para liberar su lugar: el índice único `(structureId, sequence)` no
   * distingue borrados, así que dejarla donde estaba impediría correr las
   * siguientes.
   */
  async remove(userId: string, structureId: string, deptId: string, actor: TraceActor) {
    await this.requireProcessStructure(userId, structureId);
    const actual = await this.requireDepartment(structureId, deptId);
    await this.requireCadenaEditable(
      structureId,
      `No se puede sacar el departamento "${actual.name}"`,
    );

    return withTenant(userId, async (tx) => {
      const minimo = await tx.processDepartment.findFirst({
        where: { structureId },
        orderBy: { sequence: 'asc' },
        select: { sequence: true },
      });

      await tx.processDepartment.update({
        where: { id: deptId },
        data: { deletedAt: new Date(), sequence: Math.min(minimo?.sequence ?? 0, 0) - 1 },
      });

      // Cerrar el hueco: las etapas posteriores suben una posición.
      const restantes = await tx.processDepartment.findMany({
        where: { structureId, deletedAt: null },
        orderBy: { sequence: 'asc' },
        select: { id: true, name: true, sequence: true },
      });
      await this.resequence(tx, restantes.map((d) => d.id));

      await recordTraceAudit(
        {
          entityType: 'ProcessDepartment',
          entityId: deptId,
          action: 'eliminar',
          actor,
          before: this.serialize(actual),
          after: { cadena: restantes.map((d) => d.name) },
        },
        tx,
      );

      return { removed: actual.name, departments: restantes.map((d) => d.name) };
    });
  }

  /**
   * Reordena la cadena entera. Recibe TODOS los ids en el orden nuevo: un
   * reordenamiento parcial dejaría la cadena ambigua.
   */
  async reorder(userId: string, structureId: string, orderedIds: string[], actor: TraceActor) {
    await this.requireProcessStructure(userId, structureId);
    await this.requireCadenaEditable(structureId, 'No se puede reordenar la cadena');

    const actuales = await this.db.processDepartment.findMany({
      where: { structureId, deletedAt: null },
      orderBy: { sequence: 'asc' },
    });

    const esperados = new Set(actuales.map((d) => d.id));
    const recibidos = new Set(orderedIds);
    if (orderedIds.length !== actuales.length || esperados.size !== recibidos.size) {
      throw new UnprocessableEntityError(
        `Para reordenar hay que mandar los ${actuales.length} departamentos de la cadena, una sola vez cada uno.`,
      );
    }
    for (const id of orderedIds) {
      if (!esperados.has(id)) {
        throw new UnprocessableEntityError(
          'Uno de los departamentos del nuevo orden no pertenece a esta estructura de costos.',
        );
      }
    }

    return withTenant(userId, async (tx) => {
      await this.resequence(tx, orderedIds);

      const final = await tx.processDepartment.findMany({
        where: { structureId, deletedAt: null },
        orderBy: { sequence: 'asc' },
      });

      await recordTraceAudit(
        {
          entityType: 'ProcessDepartment',
          entityId: structureId,
          action: 'reordenar',
          actor,
          before: { cadena: actuales.map((d) => d.name) },
          after: { cadena: final.map((d) => d.name) },
        },
        tx,
      );

      return { departments: final.map((d) => this.serialize(d)) };
    });
  }

  // --------------------------------------------------------------------------
  // Internos
  // --------------------------------------------------------------------------

  /**
   * Asigna 1..n en el orden recibido, en DOS PASADAS.
   *
   * El índice único `(structureId, sequence)` se chequea fila por fila, no al
   * final de la transacción: escribir directamente las posiciones nuevas choca
   * con las viejas apenas dos departamentos intercambian lugares. La primera
   * pasada los estaciona en un rango que nadie usa (negativo, por debajo de las
   * bajas lógicas) y la segunda los baja a su posición definitiva.
   */
  private async resequence(tx: Prisma.TransactionClient, orderedIds: string[]): Promise<void> {
    const PARKING = -1000000;
    for (const [i, id] of orderedIds.entries()) {
      await tx.processDepartment.update({ where: { id }, data: { sequence: PARKING - i } });
    }
    for (const [i, id] of orderedIds.entries()) {
      await tx.processDepartment.update({ where: { id }, data: { sequence: i + 1 } });
    }
  }

  private async requireProcessStructure(userId: string, structureId: string) {
    const structure = await this.db.costStructure.findFirst({
      where: { id: structureId, userId, deletedAt: null },
    });
    if (!structure) throw new NotFoundError('Estructura de costos no encontrada');
    if (structure.costingSystem !== 'PROCESSES') {
      throw new UnprocessableEntityError(
        `La estructura «${structure.productName}» usa Costeo por Órdenes; los departamentos de proceso ` +
          'solo aplican a estructuras de Costeo por Procesos.',
      );
    }
    return structure;
  }

  private async requireDepartment(structureId: string, deptId: string): Promise<DepartmentRow> {
    const dept = await this.db.processDepartment.findFirst({
      where: { id: deptId, structureId, deletedAt: null },
    });
    if (!dept) throw new NotFoundError('Departamento de proceso no encontrado');
    return this.serialize(dept);
  }

  private requireName(raw: string): string {
    const name = (raw ?? '').trim();
    if (name.length === 0) {
      throw new UnprocessableEntityError('El departamento necesita un nombre.');
    }
    return name;
  }

  /** Dos etapas con el mismo nombre vuelven ilegible todo mensaje del sistema. */
  private async requireNameLibre(structureId: string, name: string, exceptId: string | null) {
    const chocan = await this.db.processDepartment.findFirst({
      where: {
        structureId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (chocan) {
      throw new UnprocessableEntityError(
        `Ya hay un departamento llamado "${name}" en esta estructura. Usá un nombre distinto: ` +
          'los mensajes del sistema identifican cada etapa por su nombre.',
      );
    }
  }

  private async hasRuns(structureId: string): Promise<boolean> {
    const run = await this.db.calculationRun.findFirst({
      where: { structureId },
      select: { id: true },
    });
    return run != null;
  }

  /**
   * La cadena solo se puede reordenar o recortar mientras no haya cálculos. Un
   * resultado emitido se apoya en un orden concreto de etapas; cambiarlo después
   * reinterpretaría números que ya se comunicaron.
   */
  private async requireCadenaEditable(structureId: string, queHaciamos: string) {
    if (await this.hasRuns(structureId)) {
      throw new UnprocessableEntityError(
        `${queHaciamos}: la estructura ya tiene cálculos hechos y el orden de las etapas es parte de esos ` +
          'resultados. Podés agregar un departamento al final, que no altera lo ya calculado.',
      );
    }
  }

  private serialize(d: {
    id: string;
    name: string;
    sequence: number;
    defaultConversionAvanceEqualsMO: boolean;
  }): DepartmentRow {
    return {
      id: d.id,
      name: d.name,
      sequence: d.sequence,
      defaultConversionAvanceEqualsMO: d.defaultConversionAvanceEqualsMO,
    };
  }
}
