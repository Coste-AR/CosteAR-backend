import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostStructureService } from '@/application/cost-structures/cost-structure-service.js';
import { NotFoundError } from '@/domain/errors/domain-error.js';
import { updateLateDataPolicySchema } from '@/shared/schemas/cost.schema.js';

vi.mock('@/application/audit/audit-logger.js', () => ({
  recordAudit: vi.fn(async () => undefined),
}));

/**
 * EL INTERRUPTOR QUE FALTABA (I8).
 *
 * `late-data-service.ts` respeta las tres políticas desde que se construyó la
 * bandeja de datos atrasados, y el commit que la creó dice explícitamente que
 * "la politica previa de la estructura SI puede resolverlo sola: si el costista
 * eligio de antemano, esa eleccion es su autorizacion". Pero el campo se leía en
 * cinco lugares y no se escribía en ninguno: quedaba siempre en ASK, y cada
 * factura atrasada interrumpía al costista aunque ya hubiera resuelto veinte
 * veces lo mismo.
 */

const USER = 'user-1';
const STRUCT = 'struct-1';
const ctx = { ipAddress: '127.0.0.1', userAgent: 'test' } as never;

function makeDb(structure: Record<string, unknown> | null = { id: STRUCT, userId: USER, lateDataPolicy: 'ASK' }) {
  const db: Record<string, unknown> = {
    costStructure: {
      findFirst: vi.fn(async () => structure),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: STRUCT, ...data })),
    },
  };
  db.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return db as {
    costStructure: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => vi.clearAllMocks());

describe('Política de datos atrasados — el schema', () => {
  it('acepta los tres modos que el motor sabe resolver', () => {
    for (const modo of ['ASK', 'CURRENT_PERIOD', 'REOPEN']) {
      expect(updateLateDataPolicySchema.parse({ lateDataPolicy: modo }).lateDataPolicy).toBe(modo);
    }
  });

  it('rechaza cualquier otro valor: el motor solo entiende esos tres', () => {
    expect(() => updateLateDataPolicySchema.parse({ lateDataPolicy: 'DISCARD' })).toThrow();
  });
});

describe('Política de datos atrasados — guardarla', () => {
  it('🔑 deja la decisión tomada de antemano (antes el campo no lo escribía nadie)', async () => {
    const db = makeDb();
    const updated = await new CostStructureService(db as never).updateLateDataPolicy(
      USER, STRUCT, 'CURRENT_PERIOD', ctx,
    );

    const call = db.costStructure.update.mock.calls[0]![0] as { data: { lateDataPolicy: string } };
    expect(call.data.lateDataPolicy).toBe('CURRENT_PERIOD');
    expect((updated as { lateDataPolicy: string }).lateDataPolicy).toBe('CURRENT_PERIOD');
  });

  it('se puede volver a ASK: elegir de antemano no es irreversible', async () => {
    const db = makeDb({ id: STRUCT, userId: USER, lateDataPolicy: 'REOPEN' });
    await new CostStructureService(db as never).updateLateDataPolicy(USER, STRUCT, 'ASK', ctx);

    const call = db.costStructure.update.mock.calls[0]![0] as { data: { lateDataPolicy: string } };
    expect(call.data.lateDataPolicy).toBe('ASK');
  });

  it('🔒 una estructura de otro costista no existe para este usuario', async () => {
    // Mismo criterio que el resto del servicio: NotFoundError y no Forbidden,
    // para no filtrar que ese id existe.
    const db = makeDb(null);
    const svc = new CostStructureService(db as never);

    await expect(svc.updateLateDataPolicy(USER, STRUCT, 'REOPEN', ctx)).rejects.toThrow(NotFoundError);
    expect(db.costStructure.update).not.toHaveBeenCalled();
  });
});
