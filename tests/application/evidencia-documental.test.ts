import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataPointService } from '@/application/trazabilidad/data-point-service.js';
import { createDataPointSchema, evidenceSchema } from '@/shared/schemas/trazabilidad.schema.js';

/**
 * EL RESPALDO DOCUMENTAL TIENE PUERTA DE ENTRADA (I9).
 *
 * El modelo `Evidence` estaba en la base con todo lo necesario, había un schema
 * de validación escrito para él, y `DataPointVersion.evidenceId` existía. No
 * había NINGUNA forma de crear uno: lo único posible era referenciar un
 * respaldo que nada producía, y los campos de quién lo subió y cuándo no se
 * escribían nunca.
 */

const ACTOR = { id: 'user-1', role: 'COSTISTA', area: 'costista' } as never;
const FACTURA = { kind: 'factura', reference: 'A-0001-00012345', counterparty: 'Metalúrgica SA' };

function makeTx(evidenceId = 'ev-1') {
  return {
    dataPoint: { create: vi.fn(async () => ({ id: 'dp-1' })) },
    dataPointVersion: {
      create: vi.fn(async () => ({ id: 'ver-1' })),
      findFirst: vi.fn(async () => ({ versionN: 1 })),
    },
    dataPoint_update: vi.fn(),
    evidence: { create: vi.fn(async () => ({ id: evidenceId })) },
    traceAuditLog: { create: vi.fn(async () => ({})) },
  };
}

const INPUT_BASE = {
  element: 'MP',
  fieldKey: 'precio',
  label: 'Precio',
  unit: 'kg',
  sourceArea: 'deposito',
  method: 'manual',
  valueNum: 100,
};

beforeEach(() => vi.clearAllMocks());

describe('El schema de evidencia, que estaba escrito y no usaba nadie', () => {
  it('ahora se acepta en el alta de un dato', () => {
    const parsed = createDataPointSchema.parse({ ...INPUT_BASE, evidence: FACTURA });
    expect(parsed.evidence).toEqual(FACTURA);
  });

  it('exige tipo y referencia: un respaldo sin identificar no respalda nada', () => {
    expect(() => evidenceSchema.parse({ kind: 'factura' })).toThrow();
    expect(() => evidenceSchema.parse({ kind: '', reference: 'A-1' })).toThrow();
  });

  it('rechaza una URL de archivo que no sea una URL', () => {
    expect(() => evidenceSchema.parse({ ...FACTURA, fileUrl: 'no-es-una-url' })).toThrow();
  });
});

describe('Crear el respaldo junto con el dato', () => {
  it('🔑 crea el Evidence y lo cuelga de la versión (antes no había forma de crearlo)', async () => {
    const tx = makeTx();
    await new DataPointService({} as never).createInTx(
      tx as never,
      'struct-1',
      { ...INPUT_BASE, evidence: FACTURA } as never,
      ACTOR,
    );

    const evidencia = tx.evidence.create.mock.calls[0]![0].data;
    expect(evidencia).toMatchObject(FACTURA);
    // Quién lo subió: el campo estaba en el modelo y no se escribía nunca.
    expect(evidencia.uploadedBy).toBe('user-1');

    // Y la versión queda apuntando al respaldo, que es el punto de todo esto.
    expect(tx.dataPointVersion.create.mock.calls[0]![0].data.evidenceId).toBe('ev-1');
  });

  it('sin respaldo no crea nada: adjuntarlo es opcional', async () => {
    const tx = makeTx();
    await new DataPointService({} as never).createInTx(
      tx as never,
      'struct-1',
      INPUT_BASE as never,
      ACTOR,
    );

    expect(tx.evidence.create).not.toHaveBeenCalled();
    expect(tx.dataPointVersion.create.mock.calls[0]![0].data.evidenceId).toBeUndefined();
  });

  it('un evidenceId ya existente gana: el mismo remito puede respaldar varias cifras', async () => {
    const tx = makeTx();
    await new DataPointService({} as never).createInTx(
      tx as never,
      'struct-1',
      { ...INPUT_BASE, evidenceId: 'ev-ya-existente', evidence: FACTURA } as never,
      ACTOR,
    );

    expect(tx.evidence.create).not.toHaveBeenCalled();
    expect(tx.dataPointVersion.create.mock.calls[0]![0].data.evidenceId).toBe('ev-ya-existente');
  });
});
