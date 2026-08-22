import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * B14 — DEPARTAMENTOS DE PROCESO COMO SERVICIO (Prisma mockeado).
 *
 * `sequence` no es un orden de pantalla: ES la cadena por la que viaja el costo.
 * El departamento 1 transfiere al 2, el 2 al 3, y el costo unitario del último
 * es el costo del producto terminado. Lo que se fija acá:
 *
 *   · el alta va SIEMPRE al final — nunca en el medio de la cadena;
 *   · con cálculos hechos la cadena queda congelada: no se reordena ni se
 *     recorta, pero sí se puede agregar al final;
 *   · sacar una etapa cierra el hueco que deja, sin romper el índice único
 *     `(structureId, sequence)`, que no distingue filas dadas de baja;
 *   · reordenar escribe en dos pasadas, porque ese índice se chequea fila por
 *     fila y no al final de la transacción;
 *   · una estructura de Órdenes recibe un 422 accionable.
 */

const mockTx = {
  costStructure: { findFirst: vi.fn() },
  processDepartment: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  calculationRun: { findFirst: vi.fn() },
  traceAuditLog: { create: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockTx,
  withTenant: (_userId: string, fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
}));

const { ProcessDepartmentService } = await import(
  '@/application/cost-structures/process-costing/process-department-service.js'
);
const { UnprocessableEntityError, NotFoundError } = await import(
  '@/domain/errors/domain-error.js'
);

const USER = 'user-1';
const STRUCTURE = 'struct-1';
const actor = { id: USER, role: 'COSTISTA', area: 'estructura', device: 'test · 127.0.0.1' };

const CADENA = [
  { id: 'd1', name: 'Destilado', sequence: 1, defaultConversionAvanceEqualsMO: true },
  { id: 'd2', name: 'Purificado', sequence: 2, defaultConversionAvanceEqualsMO: true },
  { id: 'd3', name: 'Embotellado', sequence: 3, defaultConversionAvanceEqualsMO: true },
];

function setup(opts: { costingSystem?: string; conRuns?: boolean; cadena?: typeof CADENA } = {}) {
  const cadena = opts.cadena ?? CADENA;

  mockTx.costStructure.findFirst.mockResolvedValue({
    id: STRUCTURE,
    productName: 'Alcohol',
    costingSystem: opts.costingSystem ?? 'PROCESSES',
    deletedAt: null,
  });
  mockTx.calculationRun.findFirst.mockResolvedValue(opts.conRuns ? { id: 'run-1' } : null);

  mockTx.processDepartment.findMany.mockResolvedValue(cadena);
  mockTx.processDepartment.findFirst.mockImplementation(async ({ where, orderBy }: any) => {
    if (orderBy?.sequence === 'desc') return cadena[cadena.length - 1] ?? null;
    if (orderBy?.sequence === 'asc') return cadena[0] ?? null;
    if (where?.id) return cadena.find((d) => d.id === where.id) ?? null;
    if (where?.name) return null; // nombre libre salvo que el test diga otra cosa
    return null;
  });
  mockTx.processDepartment.create.mockImplementation(async ({ data }: any) => ({
    id: 'd-nuevo',
    ...data,
  }));
  mockTx.processDepartment.update.mockImplementation(async ({ where, data }: any) => ({
    ...(cadena.find((d) => d.id === where.id) ?? { id: where.id, name: 'X', sequence: 0, defaultConversionAvanceEqualsMO: true }),
    ...data,
  }));

  return new ProcessDepartmentService(mockTx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('B14 — alta de departamentos', () => {
  it('agrega la etapa nueva AL FINAL de la cadena', async () => {
    const svc = setup();
    const creado = await svc.create(USER, STRUCTURE, { name: 'Etiquetado' }, actor);

    expect(creado.sequence).toBe(4); // la cadena tenía 3
    expect(creado.name).toBe('Etiquetado');
  });

  it('recorta los espacios del nombre', async () => {
    const svc = setup();
    const creado = await svc.create(USER, STRUCTURE, { name: '  Etiquetado  ' }, actor);
    expect(creado.name).toBe('Etiquetado');
  });

  it('rechaza un nombre vacío', async () => {
    const svc = setup();
    await expect(svc.create(USER, STRUCTURE, { name: '   ' }, actor)).rejects.toBeInstanceOf(
      UnprocessableEntityError,
    );
  });

  it('rechaza un nombre repetido y explica por qué importa', async () => {
    const svc = setup();
    mockTx.processDepartment.findFirst.mockImplementation(async ({ where }: any) =>
      where?.name ? { id: 'd1' } : null,
    );

    const promesa = svc.create(USER, STRUCTURE, { name: 'Destilado' }, actor);
    await expect(promesa).rejects.toThrow(/Ya hay un departamento llamado "Destilado"/);
  });

  it('deja agregar al final aunque ya haya cálculos hechos', async () => {
    const svc = setup({ conRuns: true });
    const creado = await svc.create(USER, STRUCTURE, { name: 'Etiquetado' }, actor);
    expect(creado.sequence).toBe(4);
  });

  it('audita el alta', async () => {
    const svc = setup();
    await svc.create(USER, STRUCTURE, { name: 'Etiquetado' }, actor);
    expect(mockTx.traceAuditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('B14 — la cadena se congela cuando ya hay cálculos', () => {
  it('no deja reordenar y ofrece la alternativa', async () => {
    const svc = setup({ conRuns: true });
    const promesa = svc.reorder(USER, STRUCTURE, ['d3', 'd1', 'd2'], actor);

    await expect(promesa).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(promesa).rejects.toThrow(/agregar un departamento al final/);
  });

  it('no deja sacar una etapa, y la nombra', async () => {
    const svc = setup({ conRuns: true });
    const promesa = svc.remove(USER, STRUCTURE, 'd2', actor);

    await expect(promesa).rejects.toThrow(/Purificado/);
    await expect(promesa).rejects.toThrow(/ya tiene cálculos hechos/);
  });

  it('sin cálculos, reordenar funciona', async () => {
    const svc = setup();
    await expect(svc.reorder(USER, STRUCTURE, ['d3', 'd1', 'd2'], actor)).resolves.toBeDefined();
  });
});

describe('B14 — reordenar', () => {
  it('escribe en DOS pasadas para no chocar con el índice único', async () => {
    const svc = setup();
    await svc.reorder(USER, STRUCTURE, ['d3', 'd1', 'd2'], actor);

    const secuencias = mockTx.processDepartment.update.mock.calls.map(
      ([{ data }]: any) => data.sequence,
    );
    // 3 updates a un rango de estacionamiento + 3 a la posición definitiva.
    expect(secuencias).toHaveLength(6);
    expect(secuencias.slice(0, 3).every((s: number) => s < 0)).toBe(true);
    expect(secuencias.slice(3)).toEqual([1, 2, 3]);
  });

  it('deja la cadena en el orden pedido', async () => {
    const svc = setup();
    await svc.reorder(USER, STRUCTURE, ['d3', 'd1', 'd2'], actor);

    const finales = mockTx.processDepartment.update.mock.calls
      .slice(3)
      .map(([{ where, data }]: any) => [where.id, data.sequence]);
    expect(finales).toEqual([
      ['d3', 1],
      ['d1', 2],
      ['d2', 3],
    ]);
  });

  it('exige la cadena completa: un orden parcial la dejaría ambigua', async () => {
    const svc = setup();
    const promesa = svc.reorder(USER, STRUCTURE, ['d3', 'd1'], actor);

    await expect(promesa).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(promesa).rejects.toThrow(/los 3 departamentos/);
  });

  it('rechaza un id que no es de esta estructura', async () => {
    const svc = setup();
    const promesa = svc.reorder(USER, STRUCTURE, ['d1', 'd2', 'ajeno'], actor);
    await expect(promesa).rejects.toThrow(/no pertenece a esta estructura/);
  });
});

describe('B14 — baja lógica', () => {
  it('manda la fila borrada a una secuencia negativa para liberar su lugar', async () => {
    const svc = setup();
    await svc.remove(USER, STRUCTURE, 'd2', actor);

    const [{ where, data }] = mockTx.processDepartment.update.mock.calls[0] as any;
    expect(where.id).toBe('d2');
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.sequence).toBeLessThan(0);
  });

  it('cierra el hueco: las etapas siguientes suben una posición', async () => {
    const svc = setup();
    // Después de borrar d2, las que quedan son d1 y d3.
    mockTx.processDepartment.findMany.mockResolvedValue([CADENA[0], CADENA[2]]);

    await svc.remove(USER, STRUCTURE, 'd2', actor);

    const finales = mockTx.processDepartment.update.mock.calls
      .slice(-2)
      .map(([{ where, data }]: any) => [where.id, data.sequence]);
    expect(finales).toEqual([
      ['d1', 1],
      ['d3', 2],
    ]);
  });
});

describe('B14 — guardarraíles de estructura', () => {
  it('una estructura de Órdenes recibe un 422 accionable, no un 500', async () => {
    const svc = setup({ costingSystem: 'ORDERS' });
    const promesa = svc.list(USER, STRUCTURE);

    await expect(promesa).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(promesa).rejects.toThrow(/Costeo por Órdenes/);
  });

  it('una estructura inexistente es 404, no 422', async () => {
    const svc = setup();
    mockTx.costStructure.findFirst.mockResolvedValue(null);
    await expect(svc.list(USER, STRUCTURE)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('list avisa si la cadena está congelada, para deshabilitar los controles', async () => {
    expect((await setup({ conRuns: true }).list(USER, STRUCTURE)).chainFrozen).toBe(true);
    expect((await setup().list(USER, STRUCTURE)).chainFrozen).toBe(false);
  });

  it('list devuelve la cadena en orden', async () => {
    const { departments } = await setup().list(USER, STRUCTURE);
    expect(departments.map((d) => d.name)).toEqual(['Destilado', 'Purificado', 'Embotellado']);
  });
});
