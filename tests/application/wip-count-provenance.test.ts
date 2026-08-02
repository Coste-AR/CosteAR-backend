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
