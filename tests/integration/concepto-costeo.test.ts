import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConceptoCosteoService } from '@/application/parametros/concepto-costeo-service.js';
import { TramoSemifijoService } from '@/application/parametros/tramo-semifijo-service.js';
import { TramoCostoService } from '@/application/parametros/tramo-costo-service.js';
import { PuntoCierreService } from '@/application/parametros/punto-cierre-service.js';
import { withTenantContext } from '@/infrastructure/database/tenant-context.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, db, type Tenant } from './helpers/tenants.js';

/**
 * M1-01 (plan de análisis marginal v2) — `ConceptoCosteo` contra Postgres real.
 *
 * Lo que un test con Prisma mockeado no puede probar (DOM-07): que el
 * aislamiento entre empresas lo garantice RLS, no una condición `WHERE` que
 * alguien podría olvidar. `RLS_MODELS` ya tiene a `ConceptoCosteo` — este test
 * es lo que hubiera fallado si no lo tuviera (ver `tests/config/rls-coverage.test.ts`
 * para la parte estática).
 */

const actor = (userId: string) => ({ id: userId, role: 'EMPRESA_ADMIN', area: 'costista', method: 'manual' }) as const;

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  A = await createTenant('concepto-costeo-a');
  B = await createTenant('concepto-costeo-b');
});

afterAll(disconnect);

describe('ConceptoCosteo: CRUD, cascada y aislamiento', () => {
  it('crea, resuelve por cascada y borra lógicamente', async () => {
    const service = new ConceptoCosteoService(db);

    const creado = await withTenantContext(A.userId, () =>
      service.crear(
        A.userId,
        A.companyId,
        { clave: 'energia_planta', elemento: 'CIP', comportamientoVolumen: 'VARIABLE', causaVariabilidad: 'volumen', confirmado: true },
        actor(A.userId),
      ),
    );
    expect(creado.clave).toBe('energia_planta');

    const listado = await withTenantContext(A.userId, () => service.listar(A.userId, A.companyId));
    expect(listado).toHaveLength(1);
    expect(listado[0]).toMatchObject({ clave: 'energia_planta', origen: 'empresa' });

    await withTenantContext(A.userId, () => service.eliminar(A.userId, A.companyId, creado.id, actor(A.userId)));
    const trasBorrar = await withTenantContext(A.userId, () => service.listar(A.userId, A.companyId));
    expect(trasBorrar).toHaveLength(0);
  });

  it('período le gana a empresa en la cascada real', async () => {
    const service = new ConceptoCosteoService(db);
    await withTenantContext(A.userId, () =>
      service.crear(A.userId, A.companyId, { clave: 'flete_venta', elemento: 'VENTA', comportamientoVolumen: 'FIJO', confirmado: true }, actor(A.userId)),
    );
    await withTenantContext(A.userId, () =>
      service.crear(
        A.userId, A.companyId,
        { clave: 'flete_venta', elemento: 'VENTA', comportamientoVolumen: 'VARIABLE', causaVariabilidad: 'volumen', confirmado: true, periodId: A.periodId },
        actor(A.userId),
      ),
    );

    const resuelto = await withTenantContext(A.userId, () =>
      service.listar(A.userId, A.companyId, { periodId: A.periodId }),
    );
    const flete = resuelto.find((c) => c.clave === 'flete_venta');
    expect(flete).toMatchObject({ comportamientoVolumen: 'VARIABLE', origen: 'periodo' });
  });

  it('rechaza con 422 la amortización cargada como VARIABLE con causa tiempo (R4/R6/R8)', async () => {
    const service = new ConceptoCosteoService(db);
    await expect(
      withTenantContext(A.userId, () =>
        service.crear(
          A.userId, A.companyId,
          { clave: 'amortizacion_plantel', elemento: 'CIP', comportamientoVolumen: 'VARIABLE', causaVariabilidad: 'tiempo', confirmado: true },
          actor(A.userId),
        ),
      ),
    ).rejects.toThrow(/R4|R6|R8/);
  });

  it('la empresa B no ve ni puede tocar los conceptos de la empresa A — RLS real', async () => {
    const service = new ConceptoCosteoService(db);
    await withTenantContext(A.userId, () =>
      service.crear(A.userId, A.companyId, { clave: 'solo_de_a', elemento: 'CIP', confirmado: false }, actor(A.userId)),
    );

    const vistoPorB = await withTenantContext(B.userId, () => service.listar(B.userId, B.companyId));
    expect(vistoPorB.find((c) => c.clave === 'solo_de_a')).toBeUndefined();

    // Ni siquiera adivinando el companyId de A: la empresa no es "de" B.
    await expect(
      withTenantContext(B.userId, () => service.listar(B.userId, A.companyId)),
    ).rejects.toThrow(/empresa no encontrada/i);
  });

  it('empresa sin ningún ConceptoCosteo: listar devuelve vacío, no rompe nada (compatibilidad hacia atrás)', async () => {
    const solitaria = await createTenant('concepto-costeo-solitaria');
    const service = new ConceptoCosteoService(db);
    const listado = await withTenantContext(solitaria.userId, () => service.listar(solitaria.userId, solitaria.companyId));
    expect(listado).toEqual([]);
  });

  it('TramoSemifijo: guarda versiones, audita observaciones y RLS impide acceso cruzado', async () => {
    const conceptos = new ConceptoCosteoService(db);
    const tramos = new TramoSemifijoService(db);
    const concepto = await withTenantContext(A.userId, () =>
      conceptos.crear(
        A.userId,
        A.companyId,
        { clave: 'energia_semifija', elemento: 'CIP', comportamientoVolumen: 'SEMIFIJO', confirmado: true },
        actor(A.userId),
      ),
    );

    const primero = await withTenantContext(A.userId, () => tramos.guardar(
      A.userId,
      A.companyId,
      concepto.id,
      {
        importe: 90000,
        metodo: 'PUNTOS_EXTREMOS',
        observacionesBase: [{ volumen: 100, importe: 60000 }, { volumen: 200, importe: 90000 }],
      },
      actor(A.userId),
    ));
    expect(primero).toMatchObject({ porcionFija: expect.anything(), porcionVariable: expect.anything() });

    const segundo = await withTenantContext(A.userId, () => tramos.guardar(
      A.userId,
      A.companyId,
      concepto.id,
      { importe: 90000, metodo: 'DECLARADO', porcionFija: 54000, porcionVariable: 36000 },
      actor(A.userId),
    ));
    expect(Number(segundo.porcionVariable)).toBe(36000);

    const versiones = await withTenant(A.userId, (tx) => tx.tramoSemifijo.findMany({
      where: { conceptoId: concepto.id },
      orderBy: { createdAt: 'asc' },
    }));
    expect(versiones).toHaveLength(2);
    expect(versiones[0].deletedAt).not.toBeNull();
    expect(versiones[1].deletedAt).toBeNull();

    await expect(withTenantContext(B.userId, () =>
      tramos.obtener(B.userId, A.companyId, concepto.id),
    )).rejects.toThrow(/empresa no encontrada/i);
  });

  it('TramoCosto: corrige con versión nueva y el cálculo conserva los ids usados', async () => {
    const conceptos = new ConceptoCosteoService(db);
    const tramos = new TramoCostoService(db);
    const concepto = await withTenantContext(A.userId, () => conceptos.crear(
      A.userId, A.companyId,
      { clave: 'estructura_galpon', elemento: 'CIP', comportamientoVolumen: 'FIJO', confirmado: true },
      actor(A.userId),
    ));
    const primero = await withTenantContext(A.userId, () => tramos.guardar(A.userId, A.companyId, {
      conceptoId: concepto.id, desde: 0, hasta: 500, tipo: 'REEMPLAZA', importeFijo: 1780000,
      cmUnitaria: 2974, techoFisico: 475.7, techoFuente: 'Informe técnico de capacidad',
    }, actor(A.userId)));
    const segundo = await withTenantContext(A.userId, () => tramos.guardar(A.userId, A.companyId, {
      reemplazaId: primero.id, conceptoId: concepto.id, desde: 0, hasta: 500, tipo: 'REEMPLAZA', importeFijo: 1780000,
      cmUnitaria: 2974, techoFisico: 480, techoFuente: 'Informe técnico corregido',
    }, actor(A.userId)));
    const calculo = await withTenantContext(A.userId, () => tramos.calcularYGuardar(A.userId, A.companyId, actor(A.userId)));
    expect(calculo.tramos[0]).toMatchObject({ tramoId: segundo.id, q: null });

    const versiones = await withTenant(A.userId, (tx) => tx.tramoCosto.findMany({ where: { conceptoId: concepto.id } }));
    expect(versiones).toHaveLength(2);
    expect(versiones.find((fila) => fila.id === primero.id)?.deletedAt).not.toBeNull();
    const foto = await withTenant(A.userId, (tx) => tx.equilibrioTramosCalculo.findUniqueOrThrow({ where: { id: calculo.calculoId } }));
    expect(foto.tramoCostoIds).toEqual([segundo.id]);

    await expect(withTenantContext(B.userId, () => tramos.listar(B.userId, A.companyId)))
      .rejects.toThrow(/empresa no encontrada/i);
  });

  it('ImporteConcepto: corrige con fila nueva, conserva versiones y RLS aísla empresas', async () => {
    const conceptos = new ConceptoCosteoService(db);
    const puntoCierre = new PuntoCierreService(db);
    const concepto = await withTenantContext(A.userId, () => conceptos.crear(
      A.userId, A.companyId,
      { clave: 'costo_variable_versionado', elemento: 'MP', comportamientoVolumen: 'VARIABLE', causaVariabilidad: 'volumen', erogable: true, horizonteErogableMeses: 1, confirmado: true },
      actor(A.userId),
    ));
    const primero = await withTenantContext(A.userId, () => puntoCierre.guardarImporte(A.userId, 'EMPRESA_ADMIN', A.companyId, concepto.id, {
      importeVariableUnitario: 200, moneda: 'ARS', unidad: 'unidad', vigenteDesde: '2026-01-01T00:00:00.000Z',
    }, actor(A.userId)));
    const segundo = await withTenantContext(A.userId, () => puntoCierre.guardarImporte(A.userId, 'EMPRESA_ADMIN', A.companyId, concepto.id, {
      importeVariableUnitario: 244, moneda: 'ARS', unidad: 'unidad', vigenteDesde: '2026-02-01T00:00:00.000Z',
    }, actor(A.userId)));
    expect(segundo.id).not.toBe(primero.id);
    const versiones = await withTenant(A.userId, (tx) => tx.conceptoCosteoImporte.findMany({ where: { conceptoId: concepto.id }, orderBy: { vigenteDesde: 'asc' } }));
    expect(versiones.map((v) => Number(v.importeVariableUnitario))).toEqual([200, 244]);
    await expect(withTenant(A.userId, (tx) => tx.conceptoCosteoImporte.update({ where: { id: primero.id }, data: { importeVariableUnitario: 1 } }))).rejects.toThrow();
    const vistoPorB = await withTenant(B.userId, (tx) => tx.conceptoCosteoImporte.findMany({ where: { conceptoId: concepto.id } }));
    expect(vistoPorB).toEqual([]);
  });
});
