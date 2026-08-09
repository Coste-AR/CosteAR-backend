import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * DE DÓNDE SALIÓ EL GRADO DE AVANCE (D7).
 *
 * La cátedra lo dice tres veces: lo determina la oficina técnica, y el área de
 * costos "lo recibe y aplica, NO LO ESTIMA". El sistema no puede prohibirle al
 * costista cargarlo —el día que planta no contesta quedaría inusable— pero sí
 * tiene que dejar constancia de cuál de los dos casos fue.
 */

const COSTISTA = 'user-1';
const OPERARIO_TECNICO = 'op-tecnico';
const OPERARIO_COMUN = 'op-comun';

function makeDb(over: Record<string, unknown> = {}) {
  return {
    operatorMembership: {
      findFirst: vi.fn(async ({ where }: { where: { operatorId: string } }) =>
        where.operatorId === OPERARIO_TECNICO ? { id: 'mem-1' } : null,
      ),
    },
    ...over,
  };
}

/**
 * Se prueba la regla sola. Montar todo `save()` exigiría replicar el contexto
 * del cuadro de movimiento entero, y lo que importa acá es la decisión.
 */
async function countSourceFor(db: unknown, userId: string, actorId: string) {
  const { UnitMovementService } = await import(
    '@/application/cost-structures/process-costing/unit-movement-service.js'
  );
  const svc = new UnitMovementService(db as never);
  // @ts-expect-error — método privado: se prueba la regla, no la fachada.
  return svc.countSourceFor(userId, { id: actorId, role: 'x', area: 'planta' });
}

beforeEach(() => vi.clearAllMocks());

describe('Procedencia del grado de avance', () => {
  it('un operario CON el permiso de recuento es la oficina técnica', async () => {
    const db = makeDb();
    expect(await countSourceFor(db, COSTISTA, OPERARIO_TECNICO)).toBe('TECHNICAL_OFFICE');
  });

  it('el costista cargándolo él queda marcado como estimación de costos', async () => {
    const db = makeDb();
    // No se prohíbe: si planta no contesta, el costista tiene que poder seguir.
    // Pero no puede quedar registrado como si lo hubiera informado planta.
    expect(await countSourceFor(db, COSTISTA, COSTISTA)).toBe('COSTIST_ESTIMATE');
  });

  it('un operario SIN el permiso tampoco cuenta como oficina técnica', async () => {
    const db = makeDb();
    expect(await countSourceFor(db, COSTISTA, OPERARIO_COMUN)).toBe('COSTIST_ESTIMATE');
  });

  it('al costista ni se le consulta la membresía: es el dueño, no un operario', async () => {
    const db = makeDb();
    await countSourceFor(db, COSTISTA, COSTISTA);
    expect(db.operatorMembership.findFirst).not.toHaveBeenCalled();
  });

  it('el permiso se chequea sobre membresías ACTIVAS y con el permiso puesto', async () => {
    const db = makeDb();
    await countSourceFor(db, COSTISTA, OPERARIO_TECNICO);

    const where = db.operatorMembership.findFirst.mock.calls[0]![0].where;
    expect(where.isActive).toBe(true);
    expect(where.canReportWipCount).toBe(true);
  });
});

/**
 * La procedencia se guardaba bien y no la leía nadie: ningún endpoint la
 * devolvía, así que la promesa que el asistente de setup le hace al cliente
 * —"la diferencia se ve en la trazabilidad"— no se cumplía en ninguna pantalla.
 */
describe('La procedencia viaja hasta la pantalla', () => {
  async function serviceWith(db: unknown) {
    const { UnitMovementService } = await import(
      '@/application/cost-structures/process-costing/unit-movement-service.js'
    );
    return new UnitMovementService(db as never);
  }

  const userDb = (name: string | null) =>
    makeDb({ user: { findUnique: vi.fn(async () => (name === null ? null : { name })) } });

  it('devuelve procedencia, fecha y nombre de quien informó el recuento', async () => {
    const svc = await serviceWith(userDb('Juan Pérez'));
    const countedAt = new Date('2026-08-06T12:00:00.000Z');

    // @ts-expect-error — métodos privados: se prueba el contrato que ve el front.
    const name = await svc.countedByName('op-tecnico');
    // @ts-expect-error — idem.
    const out = svc.serializeRow({ countSource: 'TECHNICAL_OFFICE', countedAt }, name);

    expect(out.countSource).toBe('TECHNICAL_OFFICE');
    expect(out.countedAt).toBe('2026-08-06T12:00:00.000Z');
    expect(out.countedByName).toBe('Juan Pérez');
  });

  it('un mes recién abierto por el arrastre viaja como NOT_COUNTED, no como un hueco', async () => {
    // Es la distinción que pedía el doc: sin esto, un mes cuya existencia final
    // no contó nadie se ve igual que uno con recuento hecho.
    const svc = await serviceWith(userDb(null));
    // @ts-expect-error — método privado.
    const out = svc.serializeRow({ countSource: 'NOT_COUNTED', countedAt: null }, null);

    expect(out.countSource).toBe('NOT_COUNTED');
    expect(out.countedAt).toBeNull();
    expect(out.countedByName).toBeNull();
  });

  it('si el usuario que informó ya no existe, el nombre es null y no un uuid', async () => {
    const svc = await serviceWith(userDb(null));
    // @ts-expect-error — método privado.
    expect(await svc.countedByName('borrado')).toBeNull();
  });

  it('sin nadie que haya informado, ni se consulta la tabla de usuarios', async () => {
    const db = userDb('Juan Pérez');
    const svc = await serviceWith(db);
    // @ts-expect-error — método privado.
    expect(await svc.countedByName(null)).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});
