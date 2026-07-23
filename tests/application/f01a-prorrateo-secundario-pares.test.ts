import { describe, it, expect } from 'vitest';
import { computeProductiveBudgets } from '@/domain/calculations/calculate.js';
import {
  indirectCostConfigSchema,
  normalizeIndirectConfigForRead,
} from '@/shared/schemas/cost.schema.js';

/**
 * F01-A — El reparto secundario mapea por ID DE DESTINO, no por posición.
 *
 * Bug original (testeo caja negra 20/07): el frontend omitía la columna del
 * propio centro de cada fila y el backend leía esos valores POSICIONALMENTE
 * contra la lista completa de centros. Un valor podía aterrizar en el centro
 * equivocado —o sobre el propio centro de la fila— y disparar "no puede
 * repartirse a sí mismo", o peor, repartir 60/40 como 40/60 sin avisar.
 *
 * El contrato ahora son PARES EXPLÍCITOS `{ centroDestinoId, fijo, variable }`:
 * cada valor viaja con su centro destino. Estos tests prueban que el orden de
 * las filas es IRRELEVANTE (mapeo por id) y que los casos de la cátedra cierran.
 */
describe('F01-A — prorrateo secundario por pares explícitos (mapeo por id, no por posición)', () => {
  // Caso de aceptación: 2 productivos (Mecanizado, Terminado) + 2 de servicio
  // (Mantenimiento 60/40, Adm. Planta 55/45). Primario cargado con conceptos
  // 'direct' que caen enteros en cada centro para aislar el secundario.
  const centers = [
    { id: 'mecanizado', name: 'Mecanizado', type: 'productive' as const },
    { id: 'terminado', name: 'Terminado', type: 'productive' as const },
    { id: 'mantenimiento', name: 'Mantenimiento', type: 'service' as const },
    { id: 'admplanta', name: 'Adm. Planta', type: 'service' as const },
  ];
  const concepts = [
    { name: 'CIF Mecanizado', amount: { fixed: 5000, variable: 3000 }, distribution: { mecanizado: 1 } },
    { name: 'CIF Terminado', amount: { fixed: 4000, variable: 2000 }, distribution: { terminado: 1 } },
    { name: 'CIF Mantenimiento', amount: { fixed: 1000, variable: 500 }, distribution: { mantenimiento: 1 } },
    { name: 'CIF Adm. Planta', amount: { fixed: 2000, variable: 1000 }, distribution: { admplanta: 1 } },
  ];
  // Σ primario = 12.000 f / 6.500 v (nada se pierde: los servicios cierran en 0).
  const TOTAL_FIXED = 12000;
  const TOTAL_VARIABLE = 6500;

  const rowMantenimiento = {
    serviceCenterId: 'mantenimiento',
    distributions: [
      { centroDestinoId: 'mecanizado', fijo: 60, variable: 60 },
      { centroDestinoId: 'terminado', fijo: 40, variable: 40 },
    ],
  };
  const rowAdmPlanta = {
    serviceCenterId: 'admplanta',
    distributions: [
      { centroDestinoId: 'mecanizado', fijo: 55, variable: 55 },
      { centroDestinoId: 'terminado', fijo: 45, variable: 45 },
    ],
  };

  function budgetsFor(serviceRows: unknown[], closureOrder?: string[]) {
    const config = indirectCostConfigSchema.parse({
      centers,
      concepts,
      serviceDistributions: serviceRows,
      ...(closureOrder ? { closureOrder } : {}),
      productiveSettings: [],
    });
    return computeProductiveBudgets(config);
  }

  it('con 2 productivos + 2 de servicio, ambos servicios cierran en 0 (Σ = Σ primario)', () => {
    const budgets = budgetsFor([rowMantenimiento, rowAdmPlanta]);
    // Los servicios no figuran entre los productivos → cerraron en 0.
    expect(budgets.mantenimiento).toBeUndefined();
    expect(budgets.admplanta).toBeUndefined();
    // No se pierde ni un centavo.
    expect(budgets.mecanizado!.fixed + budgets.terminado!.fixed).toBeCloseTo(TOTAL_FIXED, 6);
    expect(budgets.mecanizado!.variable + budgets.terminado!.variable).toBeCloseTo(TOTAL_VARIABLE, 6);
  });

  it('REGRESIÓN: reordenar las filas de servicio da números IDÉNTICOS (pasada directa)', () => {
    const orderA = budgetsFor([rowMantenimiento, rowAdmPlanta]);
    const orderB = budgetsFor([rowAdmPlanta, rowMantenimiento]);
    // Con Mantenimiento primero, o con Adm. Planta primero: mismos números.
    // (Con el bug posicional, invertir el orden cambiaba a quién se acusaba y
    //  reasignaba los porcentajes al centro equivocado.)
    expect(orderB).toEqual(orderA);
  });

  it('REGRESIÓN: reordenar las filas con orden de cierre escalonado también da IDÉNTICO', () => {
    // El orden de CIERRE es el mismo; solo cambia el orden del ARRAY de filas.
    // Como el motor mapea por serviceCenterId, el orden del array no altera nada.
    const closureOrder = ['mantenimiento', 'admplanta'];
    const orderA = budgetsFor([rowMantenimiento, rowAdmPlanta], closureOrder);
    const orderB = budgetsFor([rowAdmPlanta, rowMantenimiento], closureOrder);
    expect(orderB).toEqual(orderA);
    // Y ningún servicio se acusa de repartirse a sí mismo: ambos cierran en 0.
    expect(orderA.mantenimiento).toBeUndefined();
    expect(orderA.admplanta).toBeUndefined();
    expect(orderA.mecanizado!.fixed + orderA.terminado!.fixed).toBeCloseTo(TOTAL_FIXED, 6);
  });

  it('una sola fila de servicio también funciona (el bug fallaba hasta con una)', () => {
    // Solo Mantenimiento reparte; Adm. Planta no reparte (se saca de la lista y
    // su primario no existe para no dejar costo sin cerrar).
    const centersSolo = centers.filter((c) => c.id !== 'admplanta');
    const conceptsSolo = concepts.filter((c) => c.name !== 'CIF Adm. Planta');
    const config = indirectCostConfigSchema.parse({
      centers: centersSolo,
      concepts: conceptsSolo,
      serviceDistributions: [rowMantenimiento],
      productiveSettings: [],
    });
    const budgets = computeProductiveBudgets(config);
    expect(budgets.mantenimiento).toBeUndefined();
    // Σ primario ahora = 10.000 f / 5.500 v.
    expect(budgets.mecanizado!.fixed + budgets.terminado!.fixed).toBeCloseTo(10000, 6);
    expect(budgets.mecanizado!.variable + budgets.terminado!.variable).toBeCloseTo(5500, 6);
  });

  it('reparto 60/40 llega como 60/40 al centro correcto (no se invierte)', () => {
    // Mantenimiento (1.000 f) reparte 60% a Mecanizado y 40% a Terminado.
    const budgets = budgetsFor([rowMantenimiento, rowAdmPlanta]);
    // Mecanizado: primario 5.000 + 60% de 1.000 (Mant) + 55% de 2.000 (Adm) = 6.700.
    expect(budgets.mecanizado!.fixed).toBeCloseTo(5000 + 600 + 1100, 6);
    // Terminado: 4.000 + 40% de 1.000 + 45% de 2.000 = 5.300.
    expect(budgets.terminado!.fixed).toBeCloseTo(4000 + 400 + 900, 6);
  });

  it('un centroDestinoId inexistente da un 422 accionable en español (no un 500), sin exponer el id', () => {
    expect(() =>
      budgetsFor([
        {
          serviceCenterId: 'mantenimiento',
          distributions: [
            { centroDestinoId: 'mecanizado', fijo: 60, variable: 60 },
            { centroDestinoId: 'centro_borrado_123', fijo: 40, variable: 40 },
          ],
        },
        rowAdmPlanta,
      ]),
    ).toThrow(/ya no existe en la estructura/);
  });

  it('RETROCOMPAT: una config LEGADA corrupta (el propio centro como destino) FALLA FUERTE con el nombre humano', () => {
    // Forma vieja por Records: por el bug de columnas, la fila de Mantenimiento
    // quedó con su PROPIO centro como clave (lo que antes disparaba el error).
    // El adaptador de lectura la convierte a pares y el motor la rechaza con un
    // mensaje accionable por NOMBRE humano, sin reasignar en silencio.
    let msg = '';
    try {
      budgetsFor([
        { serviceCenterId: 'mantenimiento', toProductive: { mecanizado: 60, mantenimiento: 40 } },
        rowAdmPlanta,
      ]);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/no puede repartirse a sí mismo/);
    // Nombre humano presente; id interno ausente (parámetro #7).
    expect(msg).toContain('Mantenimiento');
    expect(msg).not.toContain('mantenimiento'); // el id interno en minúscula no se filtra
  });
});

describe('F01-A — el adaptador de LECTURA entrega siempre pares al frontend', () => {
  it('convierte una config LEGADA por Records a `distributions` sin romper ni reescribir', () => {
    const legacy = {
      centers: [{ id: 'mant', name: 'Mantenimiento', type: 'service' }],
      concepts: [],
      serviceDistributions: [
        {
          serviceCenterId: 'mant',
          // Forma vieja: combinado + discriminado fijo/variable.
          toProductive: { corte: 60, armado: 40 },
          toProductiveVariable: { corte: 70, armado: 30 },
        },
      ],
      productiveSettings: [],
    };
    const read = normalizeIndirectConfigForRead(legacy) as {
      serviceDistributions: Array<{ serviceCenterId: string; distributions: unknown[] }>;
    };
    expect(read.serviceDistributions[0]!.distributions).toEqual([
      { centroDestinoId: 'corte', fijo: 60, variable: 70 },
      { centroDestinoId: 'armado', fijo: 40, variable: 30 },
    ]);
    // No expone la forma vieja al frontend.
    expect(read.serviceDistributions[0]).not.toHaveProperty('toProductive');
  });

  it('deja intacta una config ya en la forma nueva (idempotente) y tolera valores raros', () => {
    const modern = {
      serviceDistributions: [
        { serviceCenterId: 'mant', distributions: [{ centroDestinoId: 'corte', fijo: 1, variable: 2 }] },
      ],
    };
    expect(normalizeIndirectConfigForRead(modern)).toEqual({
      serviceDistributions: [
        { serviceCenterId: 'mant', distributions: [{ centroDestinoId: 'corte', fijo: 1, variable: 2 }], distributionMode: 'manual' },
      ],
    });
    // No rompe con null / formas inesperadas.
    expect(normalizeIndirectConfigForRead(null)).toBeNull();
    expect(normalizeIndirectConfigForRead({ foo: 1 })).toEqual({ foo: 1 });
  });
});
