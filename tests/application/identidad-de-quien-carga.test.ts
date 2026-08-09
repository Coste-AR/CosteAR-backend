import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * QUIÉN CARGÓ CADA DATO (I5).
 *
 * La trazabilidad podía decir QUÉ número entró y CUÁNDO, pero en el camino del
 * portal no podía decir QUIÉN lo mandó: el rastro se cortaba en "alguien de esta
 * empresa". Y una pantalla que muestra "rol: EMPRESA_OPERATOR" da la impresión
 * de que el dato está identificado, que es peor que no decir nada.
 */

/**
 * El mock va al tope del archivo y no adentro de un test: `vi.mock` se iza y se
 * aplica al módulo antes de cualquier import, siempre.
 *
 * La primera versión usaba `vi.doMock` + import dinámico. Pasaba corriendo este
 * archivo solo, y falló en CI dentro de la suite completa: para cuando el test
 * registraba el mock, el módulo ya estaba resuelto por otra vía. Un test que
 * depende del orden en que corren los archivos no prueba nada.
 */
vi.mock('@/application/ingest/ingest-data-entry.js', () => ({
  ingestDataEntry: vi.fn(async () => ({ isDuplicate: false })),
}));

const { EmpresaPortalService } = await import('@/application/empresa/empresa-portal-service.js');
const { DataPointService } = await import('@/application/trazabilidad/data-point-service.js');
const { ingestDataEntry } = await import('@/application/ingest/ingest-data-entry.js');

const OPERARIO = 'op-1';
const OTRO_OPERARIO = 'op-2';

beforeEach(() => vi.clearAllMocks());

describe('a · el documento del portal registra quién lo subió', () => {
  it('🔑 submitDocument le pasa el operatorId a la ingesta (antes lo descartaba)', async () => {
    const db = {
      operatorMembership: {
        findMany: vi.fn(async () => [
          {
            connectionId: 'conn-1',
            connection: { costistId: 'costista-1', companyId: 'comp-1' },
          },
        ]),
      },
    };

    await new EmpresaPortalService(db as never).submitDocument(OPERARIO, {
      rawContent: 'Factura de energía',
      sourceType: 'TEXT',
    });

    expect(vi.mocked(ingestDataEntry).mock.calls[0]![0]).toMatchObject({ uploadedBy: OPERARIO });
  });

  it('🔑 "mis envíos" filtra por persona, no por empresa', async () => {
    const db = {
      operatorMembership: { findMany: vi.fn(async () => [{ connectionId: 'conn-1' }]) },
      dataEntry: { findMany: vi.fn(async () => []) },
    };

    await new EmpresaPortalService(db as never).listMySubmissions(OPERARIO);

    const where = db.dataEntry.findMany.mock.calls[0]![0].where;
    // Lo propio, más los anteriores al campo (sin autor conocido). Nunca lo de
    // un compañero: eso era lo que hacía que "mis envíos" no fueran míos.
    expect(where.OR).toEqual([{ uploadedBy: OPERARIO }, { uploadedBy: null }]);
    expect(JSON.stringify(where)).not.toContain(OTRO_OPERARIO);
  });
});

describe('c · el puesto se ESTAMPA en la versión, no se lee después', () => {
  /**
   * El puesto llega YA RESUELTO en el actor, no se busca acá adentro. Este
   * método escribe muchos datos por guardado (el cuadro de movimiento traza
   * cada cifra manual), así que buscarlo en cada uno sería una consulta por
   * fila para el mismo dato — y obligaría a que toda transacción que pase por
   * acá conozca la tabla de membresías.
   */
  async function versionEscrita(jobTitle: string | null | undefined) {
    const create = vi.fn(async () => ({ id: 'ver-1' }));
    const tx = {
      dataPoint: { create: vi.fn(async () => ({ id: 'dp-1' })) },
      dataPointVersion: { create },
      traceAuditLog: { create: vi.fn(async () => ({})) },
    };

    await new DataPointService({} as never).createInTx(
      tx as never,
      'struct-1',
      { element: 'MP', fieldKey: 'precio', label: 'Precio', unit: 'kg', sourceArea: 'deposito', method: 'MANUAL', valueNum: 100 } as never,
      { id: OPERARIO, role: 'EMPRESA_OPERATOR', area: 'deposito', jobTitle } as never,
    );

    return create.mock.calls[0]![0].data as { actorRole: string; actorJobTitle: string | null };
  }

  it('🔑 guarda el puesto declarado junto al rol de login, no en su lugar', async () => {
    const data = await versionEscrita('Jefe de Depósito');
    expect(data.actorJobTitle).toBe('Jefe de Depósito');
    // El rol de login se conserva: son dos hechos distintos y los dos sirven.
    expect(data.actorRole).toBe('EMPRESA_OPERATOR');
  });

  it('sin puesto declarado queda en null, no inventado', async () => {
    expect((await versionEscrita(null)).actorJobTitle).toBeNull();
  });

  it('el costista no trae puesto en el actor: null, y no rompe', async () => {
    // No tiene membresía — es el dueño de la estructura, no un operario.
    expect((await versionEscrita(undefined)).actorJobTitle).toBeNull();
  });

  it('🔒 no consulta la tabla de membresías dentro de la transacción', async () => {
    // Si volviera a hacerlo, rompería todas las transacciones que componen
    // escrituras con este método sin conocer esa tabla — que es exactamente lo
    // que pasó al escribir esto la primera vez.
    const tx = {
      dataPoint: { create: vi.fn(async () => ({ id: 'dp-1' })) },
      dataPointVersion: { create: vi.fn(async () => ({ id: 'v' })) },
      traceAuditLog: { create: vi.fn(async () => ({})) },
    };

    await expect(
      new DataPointService({} as never).createInTx(
        tx as never,
        'struct-1',
        { element: 'MP', fieldKey: 'p', label: 'P', unit: 'kg', sourceArea: 'deposito', method: 'MANUAL', valueNum: 1 } as never,
        { id: OPERARIO, role: 'EMPRESA_OPERATOR', area: 'deposito', jobTitle: 'Contador' } as never,
      ),
    ).resolves.toBeDefined();
  });
});
