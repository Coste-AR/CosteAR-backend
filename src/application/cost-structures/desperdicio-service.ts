import type { PrismaClient, Prisma, NaturalezaDesperdicio as NaturalezaDb } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import type { DesperdicioRegistrado } from '../../domain/calculations/desperdicio.js';
import type {
  DesperdicioCreateInput,
  DesperdicioUpdateInput,
} from '../../shared/schemas/desperdicio.schema.js';

/**
 * DESPERDICIO DEL PERÍODO — la entrada de datos que le faltaba a la regla R5
 * (issue #92).
 *
 * El motor ya sabía imputar el desperdicio: `desperdicio.ts` implementa R5 y
 * `runCalculation` lo aplica desde el PR anterior. Pero la tabla
 * `desperdicio_registros` **no se leía ni se escribía desde ningún lado** —su
 * única mención fuera del dominio era la lista de modelos con RLS—, así que el
 * motor recibía siempre una lista vacía. Este servicio es esa mitad faltante.
 *
 * Lo que este servicio NO hace, a propósito:
 *
 *   · **No decide la naturaleza de la merma.** Se puede crear un registro sin
 *     declararla, y así queda: pendiente, fuera del cálculo y a la vista. El
 *     umbral que separa lo normal de lo extraordinario no surge del comprobante.
 *   · **No reimplementa R5.** La imputación es del dominio; acá solo se guarda
 *     el dato y se lo entrega al motor.
 *
 * Reglas del repo que aplican: los registros se borran LÓGICAMENTE (DOM-01),
 * toda mutación deja su entrada de bitácora en la MISMA transacción (DOM-02),
 * los timestamps son del servidor (DOM-03) y el aislamiento entre empresas lo
 * garantiza RLS vía `withTenant` (DOM-07).
 */
/**
 * La base guarda la naturaleza en MAYÚSCULAS (`NORMAL`) y el dominio la maneja
 * en minúsculas (`normal`). La traducción vive acá, en el borde, y en un solo
 * lugar: si cada consulta la hiciera por su cuenta, el día que alguien se olvide
 * el registro se trata como "sin declarar" y **desaparece del cálculo en
 * silencio** — que es exactamente el modo de fallar que R5 viene a evitar.
 */
const A_DOMINIO = { NORMAL: 'normal', EXTRAORDINARIA: 'extraordinaria' } as const;
const A_BASE = { normal: 'NORMAL', extraordinaria: 'EXTRAORDINARIA' } as const;

export function naturalezaADominio(v: NaturalezaDb | null): 'normal' | 'extraordinaria' | null {
  return v === null ? null : A_DOMINIO[v];
}

function naturalezaABase(v: 'normal' | 'extraordinaria' | null | undefined): NaturalezaDb | null {
  return v == null ? null : A_BASE[v];
}

export class DesperdicioService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Verifica que el período exista y sea de quien lo pide.
   *
   * RLS ya impide ver el período de otra empresa; este chequeo está igual para
   * devolver un 404 claro en vez de un error opaco, y porque el aislamiento no
   * se apoya en una sola capa.
   */
  private async periodoDe(userId: string, periodId: string) {
    const periodo = await this.db.costPeriod.findFirst({ where: { id: periodId, userId } });
    if (!periodo) throw new NotFoundError('Período no encontrado');
    return periodo;
  }

  /**
   * Un período CERRADO no acepta cambios: sus números ya se dieron por buenos y
   * quedaron guardados. Modificar el desperdicio de un mes cerrado cambiaría un
   * costo que ya se usó para poner precio.
   */
  private assertPeriodoAbierto(periodo: { status: string; label: string }): void {
    if (periodo.status !== 'OPEN') {
      throw new UnprocessableEntityError(
        `El período «${periodo.label}» está cerrado y sus números ya se dieron por buenos. ` +
          'Para corregir un desperdicio de un período cerrado hay que reabrirlo.',
        { field: 'periodId' },
      );
    }
  }

  /** Los desperdicios vigentes de un período, del más nuevo al más viejo. */
  async list(userId: string, periodId: string) {
    await this.periodoDe(userId, periodId);
    return this.db.desperdicioRegistro.findMany({
      where: { periodId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    userId: string,
    periodId: string,
    input: DesperdicioCreateInput,
    actor: TraceActor,
  ) {
    const periodo = await this.periodoDe(userId, periodId);
    this.assertPeriodoAbierto(periodo);

    return withTenant(userId, async (tx) => {
      const creado = await tx.desperdicioRegistro.create({
        data: {
          companyId: periodo.companyId,
          userId,
          periodId,
          concepto: input.concepto,
          valor: input.valor,
          cantidad: input.cantidad ?? null,
          unidadId: input.unidadId ?? null,
          naturaleza: naturalezaABase(input.naturaleza),
          valorRecupero: input.valorRecupero,
          motivo: input.motivo ?? null,
        },
      });

      // DOM-02: la bitácora va en la MISMA transacción. Si falla, no queda un
      // registro sin rastro de quién lo cargó.
      await recordTraceAudit(
        {
          entityType: 'DesperdicioRegistro',
          entityId: creado.id,
          action: 'create',
          actor,
          after: creado,
          comment: `Desperdicio cargado: ${input.concepto}`,
        },
        tx,
      );

      return creado;
    });
  }

  async update(userId: string, id: string, input: DesperdicioUpdateInput, actor: TraceActor) {
    const actualDelUsuario = await this.db.desperdicioRegistro.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!actualDelUsuario) throw new NotFoundError('Desperdicio no encontrado');

    if (actualDelUsuario.periodId) {
      const periodo = await this.periodoDe(userId, actualDelUsuario.periodId);
      this.assertPeriodoAbierto(periodo);
    }

    // La coherencia entre recupero y valor no se puede validar solo con el body:
    // el usuario puede estar cambiando uno de los dos. Se compara contra lo que
    // va a quedar, no contra lo que llegó.
    const valorFinal = input.valor ?? Number(actualDelUsuario.valor);
    const recuperoFinal = input.valorRecupero ?? Number(actualDelUsuario.valorRecupero);
    if (recuperoFinal > valorFinal) {
      throw new UnprocessableEntityError(
        'El recupero no puede ser mayor que el valor de lo perdido. ' +
          'Revisá los dos importes: no se puede recuperar más de lo que se perdió.',
        { field: 'valorRecupero' },
      );
    }

    return withTenant(userId, async (tx) => {
      // Solo se tocan los campos que vinieron: un PATCH que no menciona la
      // naturaleza no la borra.
      const data: Prisma.DesperdicioRegistroUncheckedUpdateInput = {
        ...(input.concepto !== undefined && { concepto: input.concepto }),
        ...(input.valor !== undefined && { valor: input.valor }),
        ...(input.cantidad !== undefined && { cantidad: input.cantidad }),
        ...(input.unidadId !== undefined && { unidadId: input.unidadId }),
        ...(input.naturaleza !== undefined && { naturaleza: naturalezaABase(input.naturaleza) }),
        ...(input.valorRecupero !== undefined && { valorRecupero: input.valorRecupero }),
        ...(input.motivo !== undefined && { motivo: input.motivo }),
      };
      const actualizado = await tx.desperdicioRegistro.update({ where: { id }, data });

      await recordTraceAudit(
        {
          entityType: 'DesperdicioRegistro',
          entityId: id,
          action: 'update',
          actor,
          before: actualDelUsuario,
          after: actualizado,
          // Declarar la naturaleza es LA decisión que cambia el número: deja de
          // estar pendiente y pasa a costo o a resultado. Que se lea en la
          // bitácora sin abrir el diff.
          comment:
            input.naturaleza !== undefined && input.naturaleza !== actualDelUsuario.naturaleza
              ? `Naturaleza declarada: ${input.naturaleza ?? 'sin declarar'}`
              : `Desperdicio modificado: ${actualizado.concepto}`,
        },
        tx,
      );

      return actualizado;
    });
  }

  /**
   * Borrado LÓGICO (DOM-01). Un desperdicio cargado es un dato del período: si
   * se borrara de verdad, el costo de un mes cambiaría sin dejar rastro de qué
   * se sacó ni quién lo sacó.
   */
  async remove(userId: string, id: string, actor: TraceActor) {
    const actual = await this.db.desperdicioRegistro.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!actual) throw new NotFoundError('Desperdicio no encontrado');

    if (actual.periodId) {
      const periodo = await this.periodoDe(userId, actual.periodId);
      this.assertPeriodoAbierto(periodo);
    }

    return withTenant(userId, async (tx) => {
      const borrado = await tx.desperdicioRegistro.update({
        where: { id },
        // DOM-03: la hora la pone el servidor, nunca el cliente.
        data: { deletedAt: new Date() },
      });

      await recordTraceAudit(
        {
          entityType: 'DesperdicioRegistro',
          entityId: id,
          action: 'delete',
          actor,
          before: actual,
          comment: `Desperdicio dado de baja: ${actual.concepto}`,
        },
        tx,
      );

      return borrado;
    });
  }

  /**
   * Los desperdicios del período en la forma que consume el motor.
   *
   * Es el puente que faltaba: `runCalculation` recibe esto y aplica R5. Si el
   * período no tiene registros —o todavía no existe— devuelve una lista vacía y
   * el cálculo da exactamente lo mismo que antes.
   */
  async paraElMotor(userId: string, periodId: string): Promise<DesperdicioRegistrado[]> {
    const registros = await this.db.desperdicioRegistro.findMany({
      where: { periodId, userId, deletedAt: null },
    });
    return registros.map((r) => ({
      concepto: r.concepto,
      valor: Number(r.valor),
      naturaleza: naturalezaADominio(r.naturaleza),
      valorRecupero: Number(r.valorRecupero),
    }));
  }
}
