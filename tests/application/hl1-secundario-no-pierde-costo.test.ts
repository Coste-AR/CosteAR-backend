import { describe, it, expect } from 'vitest';
import {
  computeProductiveBudgets,
  runCalculation,
  type CalculationInput,
} from '@/domain/calculations/calculate.js';
import { primaryProration, secondaryProration } from '@/domain/calculations/indirect-costs.js';
import { Money } from '@/domain/value-objects/money.js';
import { MissingAllocationBaseError } from '@/domain/errors/calculation-errors.js';
import { indirectCostConfigSchema } from '@/shared/schemas/cost.schema.js';

/**
 * H-L1 — Un centro de servicio que no reparte se comía su costo en silencio.
 *
 * El prorrateo secundario tiene que transferir el costo COMPLETO de los centros
 * de servicio a los productivos. Lo que no se reparte no desaparece del negocio:
 * desaparece del CÁLCULO, y sale por un costo unitario más bajo del real. Es el
 * peor modo de fallar que puede tener este motor —sin error, con un número más
 * chico— y por eso ahora corta con un 422 accionable (DOM-04) en vez de seguir.
 *
 * Había DOS puertas al mismo agujero:
 *  - pasada DIRECTA: se itera sobre las filas de reparto cargadas, así que un
 *    servicio SIN fila nunca se recorre;
 *  - pasada ESCALONADA: se itera sobre `closureOrder`, así que un servicio que
 *    no figura en el orden nunca cierra y su costo queda fuera de los
 *    productivos, que son los únicos que se copian a la salida.
 */
describe('H-L1 — el prorrateo secundario no puede perder costo', () => {
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
  const filaMantenimiento = {
    serviceCenterId: 'mantenimiento',
    distributions: [
      { centroDestinoId: 'mecanizado', fijo: 60, variable: 60 },
      { centroDestinoId: 'terminado', fijo: 40, variable: 40 },
    ],
  };
  const filaAdmPlanta = {
    serviceCenterId: 'admplanta',
    distributions: [
      { centroDestinoId: 'mecanizado', fijo: 55, variable: 55 },
      { centroDestinoId: 'terminado', fijo: 45, variable: 45 },
    ],
  };

  /**
   * Caso Dorado (costeo por Órdenes), el mismo fixture de `calculate.test.ts`.
   * Se repite acá a propósito: ese archivo fija los números de la cátedra
   * (DOM-05) y no se toca; este lo usa para probar qué pasa cuando Mantenimiento
   * se queda sin reparto.
   */
  const dorado: CalculationInput = {
    rawMaterial: {
      materials: [
        {
          name: 'Chapa', code: 'MP-001', unit: 'u',
          wilson: { annualDemand: 6000, orderCost: 5000, holdingRate: 0.3, unitCost: 1200 },
          stockPolicy: { minConsumption: 20, maxConsumption: 40, minLeadTime: 5, maxLeadTime: 12, safetyStock: 200 },
          initialStock: { quantity: 100, unitCost: 1000 },
          movements: [
            { date: '05/01/2026', type: 'purchase', detail: 'Compra', quantity: 400, unitCost: 1200 },
            { date: '15/01/2026', type: 'consumption', detail: 'Consumo', quantity: 300 },
          ],
        },
      ],
    },
    directLabor: {
      workingDays: {
        totalDaysPerYear: 365,
        unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 0, holidaysOnWeekend: 0 },
        paidAbsence: { holidays: 15, vacations: 14, sickness: 0, specialLeaves: 0, workAccidents: 0 },
      },
      itcs: {
        derivationBase: 0.27,
        fixedArt: 0.015,
        uncertainRemunerative: [
          { name: 'PAP', coefficient: 0.05 },
          { name: 'PPP', coefficient: 0.05 },
        ],
        uncertainNonRemunerative: [],
      },
      departments: [
        { name: 'Corte', basicRemuneration: 800000, hoursWorked: 160 },
        { name: 'Ensamblaje', basicRemuneration: 600000, hoursWorked: 160 },
      ],
    },
    indirectCosts: {
      centers: [
        { id: 'corte', name: 'Corte', type: 'productive' },
        { id: 'ensam', name: 'Ensamblaje', type: 'productive' },
        { id: 'mant', name: 'Mantenimiento', type: 'service' },
      ],
      concepts: [
        { name: 'Alquiler',    amount: { fixed: 300000, variable: 0 }, distribution: { corte: 40, ensam: 40, mant: 20 } },
        { name: 'Energía',     amount: { fixed: 0, variable: 200000 }, distribution: { corte: 50, ensam: 30, mant: 20 } },
        { name: 'Lubricantes', amount: { fixed: 0, variable: 100000 }, distribution: { corte: 0,  ensam: 0,  mant: 100 } },
      ],
      serviceDistributions: [
        {
          serviceCenterId: 'mant',
          toProductiveFixed: { corte: 60, ensam: 40 },
          toProductiveVariable: { corte: 60, ensam: 40 },
        },
      ],
      productiveSettings: [
        { centerId: 'corte', normalCapacity: 160, actualActivity: 150, actualCip: 350000 },
        { centerId: 'ensam', normalCapacity: 160, actualActivity: 160, actualCip: 260000 },
      ] as CalculationInput['indirectCosts']['productiveSettings'],
    },
    inventory: { initialWorkInProcess: 0, finalWorkInProcess: 0, initialFinishedGoods: 0, finalFinishedGoods: 0 },
    sales: { unitPrice: 25000, quantity: 100 },
  };

  function presupuestos(serviceRows: unknown[], closureOrder?: string[]) {
    const config = indirectCostConfigSchema.parse({
      centers,
      concepts,
      serviceDistributions: serviceRows,
      ...(closureOrder ? { closureOrder } : {}),
      productiveSettings: [],
    });
    return computeProductiveBudgets(config);
  }

  describe('pasada directa (sin orden de cierre)', () => {
    it('corta si un centro de servicio con costo primario no tiene fila de reparto', () => {
      // Adm. Planta tiene 2.000 f / 1.000 v del primario y NO reparte.
      // Antes: el cálculo seguía y esos 3.000 se evaporaban.
      expect(() => presupuestos([filaMantenimiento])).toThrow(MissingAllocationBaseError);
    });

    it('el mensaje nombra al centro culpable y dice qué hacer (DOM-04, F09-4)', () => {
      let error: unknown;
      try {
        presupuestos([filaMantenimiento]);
      } catch (e) {
        error = e;
      }
      const err = error as MissingAllocationBaseError;
      expect(err.message).toContain('Adm. Planta');
      expect(err.message).toContain('volvé a guardar Costos Indirectos');
      // Nunca el id interno del centro (F09-4).
      expect(err.message).not.toContain('admplanta');
    });

    it('corta también si la fila existe pero está toda en cero (no reparte nada)', () => {
      const filaVacia = {
        serviceCenterId: 'admplanta',
        distributions: [
          { centroDestinoId: 'mecanizado', fijo: 0, variable: 0 },
          { centroDestinoId: 'terminado', fijo: 0, variable: 0 },
        ],
      };
      expect(() => presupuestos([filaMantenimiento, filaVacia])).toThrow(/Adm\. Planta/);
    });

    it('corta si reparte el fijo pero se olvida el variable (el variable se perdía solo)', () => {
      const soloFijo = {
        serviceCenterId: 'admplanta',
        distributions: [
          { centroDestinoId: 'mecanizado', fijo: 55, variable: 0 },
          { centroDestinoId: 'terminado', fijo: 45, variable: 0 },
        ],
      };
      expect(() => presupuestos([filaMantenimiento, soloFijo])).toThrow(/variable/);
    });

    it('con todos los servicios repartiendo, cierra y no cambia ningún número', () => {
      const b = presupuestos([filaMantenimiento, filaAdmPlanta]);
      expect(b.mecanizado!.fixed + b.terminado!.fixed).toBeCloseTo(12000, 6);
      expect(b.mecanizado!.variable + b.terminado!.variable).toBeCloseTo(6500, 6);
    });
  });

  describe('pasada escalonada (con orden de cierre)', () => {
    it('corta si un servicio con costo primario queda fuera del orden de cierre', () => {
      // Las dos filas están cargadas, pero el orden solo cierra Mantenimiento:
      // Adm. Planta nunca cierra y su costo no llega a los productivos.
      expect(() =>
        presupuestos([filaMantenimiento, filaAdmPlanta], ['mantenimiento']),
      ).toThrow(/Adm\. Planta/);
    });

    it('con el orden completo cierra y da lo mismo que la pasada directa', () => {
      const escalonado = presupuestos(
        [filaMantenimiento, filaAdmPlanta],
        ['mantenimiento', 'admplanta'],
      );
      expect(escalonado.mecanizado!.fixed + escalonado.terminado!.fixed).toBeCloseTo(12000, 6);
      expect(escalonado.mecanizado!.variable + escalonado.terminado!.variable).toBeCloseTo(6500, 6);
    });
  });

  describe('el control de cierre no da falsos positivos', () => {
    it('un reparto en tercios (división periódica) no dispara el error', () => {
      // 1.000 ÷ 3 no tiene representación exacta: el residuo de los 28 dígitos
      // de precisión no es costo perdido y no puede hacer fallar el cálculo.
      const tresProductivos = [
        { id: 'p1', name: 'P1', type: 'productive' as const },
        { id: 'p2', name: 'P2', type: 'productive' as const },
        { id: 'p3', name: 'P3', type: 'productive' as const },
        { id: 's1', name: 'Servicio', type: 'service' as const },
      ];
      const config = indirectCostConfigSchema.parse({
        centers: tresProductivos,
        concepts: [
          { name: 'CIF Servicio', amount: { fixed: 1000, variable: 100 }, distribution: { s1: 1 } },
        ],
        serviceDistributions: [
          {
            serviceCenterId: 's1',
            distributions: [
              { centroDestinoId: 'p1', fijo: 1, variable: 1 },
              { centroDestinoId: 'p2', fijo: 1, variable: 1 },
              { centroDestinoId: 'p3', fijo: 1, variable: 1 },
            ],
          },
        ],
        productiveSettings: [],
      });
      expect(() => computeProductiveBudgets(config)).not.toThrow();
      // Los tres presupuestos salen como 333.33 porque `toNumber()` redondea a 2
      // decimales al serializar: la suma da 999.99. Ese centavo es del redondeo
      // de salida, no del reparto —adentro el motor tiene los 28 dígitos— y por
      // eso el control mira el Money interno y no el número serializado.
      const b = computeProductiveBudgets(config);
      expect(b.p1!.fixed + b.p2!.fixed + b.p3!.fixed).toBeCloseTo(1000, 1);
    });
  });

  describe('los caminos que la UI no cubre', () => {
    // La UI siempre manda `closureOrder`, derivado de las filas de reparto: por
    // eso el bug nunca explotó en pantalla. A la pasada directa se llega por
    // estructuras guardadas antes de que `closureOrder` existiera, por el import
    // de Excel, por el populador de IA y por cualquier llamador de la API. Estos
    // dos tests fijan la FORMA de config que emiten esos caminos.

    it('populador de IA: la fila con `distributions: []` que agrega ya no pasa en silencio', () => {
      // `cost-structure-populator.ts` le agrega a cada centro de servicio nuevo
      // una fila `{ serviceCenterId, distributions: [] }` y nunca escribe
      // `closureOrder`. El comentario dice "para que no queden vacíos", pero la
      // fila que crea está vacía: cae en la pasada directa sin repartir nada.
      expect(() =>
        presupuestos([
          filaMantenimiento,
          { serviceCenterId: 'admplanta', distributions: [] },
        ]),
      ).toThrow(/Adm\. Planta/);
    });

    it('import de Excel: centros de servicio sin ninguna fila de reparto', () => {
      // `excel-import/extract-indirect-costs.ts` extrae centros (productivos y
      // de servicio) y conceptos, pero NO extrae repartos secundarios ni orden
      // de cierre. Un Excel con un centro de servicio entra sin ninguna fila.
      expect(() => presupuestos([])).toThrow(MissingAllocationBaseError);
    });
  });

  it('el caso Dorado sin el reparto de Mantenimiento falla en vez de abaratar el costo', () => {
    // Criterio de cierre del issue, sobre el caso de órdenes que vive en el repo
    // (el dataset D01 de la auditoría no está en ninguno de los repos).
    // Mantenimiento se lleva 20% del alquiler, 20% de la energía y el 100% de
    // los lubricantes del prorrateo primario. Sin su reparto, todo eso no llega
    // a Corte ni a Ensamblaje: antes el cálculo terminaba bien y el costo
    // unitario salía más barato. Ahora corta.
    const sinReparto: CalculationInput = {
      ...dorado,
      indirectCosts: { ...dorado.indirectCosts, serviceDistributions: [] },
    };
    expect(() => runCalculation(sinReparto)).toThrow(MissingAllocationBaseError);
    expect(() => runCalculation(sinReparto)).toThrow(/Mantenimiento/);
    // Y con el reparto puesto, el caso de cátedra sigue dando lo mismo (DOM-05).
    expect(runCalculation(dorado).indirectCostsApplied).toBe(578750);
  });

  it('REGRESIÓN: repartir el secundario no muta el resultado del primario', () => {
    // `secondaryProration` guardaba la REFERENCIA del primario en su resultado y
    // después le reasignaba los campos: repartir inflaba el primario del
    // llamador. No cambiaba ningún número mientras nadie releyera el primario,
    // pero rompe cualquier control que compare primario contra secundario.
    const cs = [
      { id: 'p1', name: 'P1', type: 'productive' as const },
      { id: 's1', name: 'Servicio', type: 'service' as const },
    ];
    const primary = primaryProration(cs, [
      { name: 'CIF P1', amount: { fixed: Money.of(1000), variable: Money.of(0) }, distribution: { p1: 1 } },
      { name: 'CIF S1', amount: { fixed: Money.of(500), variable: Money.of(0) }, distribution: { s1: 1 } },
    ]);
    secondaryProration(cs, primary, [
      { serviceCenterId: 's1', toProductive: {}, toProductiveFixed: { p1: 1 }, toProductiveVariable: {} },
    ]);
    expect(primary.p1!.fixed.toNumber()).toBe(1000);
  });
});
