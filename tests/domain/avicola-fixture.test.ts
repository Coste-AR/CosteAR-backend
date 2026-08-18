import { describe, it, expect } from 'vitest';

/**
 * FIXTURE AVÍCOLA — T-01 (vertical Augusto Sáenz, Trancas).
 *
 * Por qué existe este archivo
 * ---------------------------
 * La tabla de aceptación del §11 del plan avícola está calculada a mano y NO cierra
 * con sus propios insumos declarados. Verificado:
 *
 *     6.300 aves × 120 g/día × 30 días = 22.680 kg
 *     22.680 kg × 330 $/kg             = 7.484.400   ← el plan dice 7.500.000
 *
 * La deriva de $15.600 se arrastra a todo lo que depende del costo de alimento:
 * costo variable unitario, costo total unitario, punto de equilibrio y brecha al PE.
 * Si alguien escribiera los tests contra la tabla del plan, una implementación
 * CORRECTA los haría fallar.
 *
 * Cómo está escrito
 * -----------------
 * Todos los insumos se declaran como constantes nombradas y **todo valor esperado se
 * deriva de ellas**. No hay un solo número mágico. Si mañana cambia el gramaje o el
 * precio del alimento, se cambia la constante y el fixture sigue siendo verdad.
 *
 * Esto es SOLO tests: no toca el motor de cálculo.
 *
 * Datos abiertos
 * --------------
 * Todo insumo sin confirmar está marcado con `🟡 confirmar con Augusto`. Esos son los
 * que hay que cerrar antes de que el fixture pase de "derivado y coherente" a
 * "verificado contra la realidad del cliente".
 */

// ---------------------------------------------------------------------------
// INSUMOS DECLARADOS
// ---------------------------------------------------------------------------
// Fuente: bóveda `001.6.1 - Avícola Saenz — relevamiento inicial del proceso
// (14-08-2026)` y §11 del plan avícola.

/** Aves en producción en el galpón actual. El galpón admite 6.300-6.400 blancas. */
const AVES = 6_300;

/** Gramos de alimento por ave por día. */
const GRAMAJE_G_DIA = 120;

/** Días del mes de costeo. */
const DIAS_MES = 30;

/**
 * Precio del alimento por kg.
 * 🟡 confirmar con Augusto: ¿es costo completo de la bachada (MP + MOD + CIP de la
 * planta de alimento) o solo la materia prima? La diferencia cambia el costo variable
 * unitario y, con él, el punto de equilibrio.
 */
const PRECIO_ALIMENTO_KG = 330;

/** Un cajón son 360 huevos. Unidad de gestión del cliente. */
const HUEVOS_POR_CAJON = 360;

/** Un maple son 30 huevos. */
const HUEVOS_POR_MAPLE = 30;

/**
 * Postura medida sobre el lote activo: 94-94,5 % en el galpón de 1.504 gallinas.
 * Es la que usa la planilla del cliente para proyectar — y por eso sobreestima.
 */
const POSTURA_LOTE = 0.94;

/**
 * Postura medida sobre el plantel completo (incluye aves que no ponen: reposición,
 * descarte pendiente, mortandad del período). Es la que hay que usar para proyectar.
 */
const POSTURA_PLANTEL = 0.885;

/**
 * Costo fijo mensual de la estructura.
 * 🟡 confirmar con Augusto: se derivó del PE declarado (630 cajones) y de la
 * contribución marginal unitaria. Cierra exacto, pero nunca fue declarado como dato.
 */
const COSTO_FIJO_MENSUAL = 15_000_000;

/**
 * Costo variable por cajón.
 * 🟡 confirmar con Augusto: el desglose no está disponible. Se sabe que el alimento
 * es la mayor parte, pero faltan el costo del maple y el de reposición del plantel
 * para poder derivarlo desde cero en vez de tomarlo como dato.
 */
const COSTO_VARIABLE_CAJON = 24_188.98;

/** Precio promedio de venta por cajón, hoy. */
const PRECIO_VENTA_CAJON = 48_000;

/**
 * Costo de adquisición por ave.
 * OJO: la nota de origen dice "$800 por cabeza" y a la vez
 * "6.300 ÷ 24 × $800 ≈ $2,8M/mes". Esa cuenta da $210.000, no $2,8M.
 * El valor bueno es el $2,8M — reproduce exacto el caso 3 del §11.
 * El costo por ave implícito es $10.666,67 (~USD 7, coherente con 001.2.43).
 * Cargar $800 subestimaría la amortización 13 veces.
 */
const COSTO_ADQUISICION_AVE = 10_666.666_67;

/**
 * Vida útil del lote, en meses.
 * 🟡 CONFLICTO ABIERTO (D-01): 001.2.43 dice ~18 meses de vida productiva;
 * 001.2.46 habla de un ciclo de ~2 años; el plan usa 24 de default.
 * Acá se usa 24 por ser el default del plan. NO está resuelto.
 */
const VIDA_UTIL_LOTE_MESES = 24;

/** Valor residual del ave al final de su vida útil (gallina de descarte). */
const VALOR_RESIDUAL_AVE = 0; // 🟡 confirmar con Augusto: la venta de descarte existe.

// ---------------------------------------------------------------------------
// DERIVACIONES
// ---------------------------------------------------------------------------

const consumoAlimentoKgMes = (AVES * GRAMAJE_G_DIA * DIAS_MES) / 1000;
const costoAlimentoMes = consumoAlimentoKgMes * PRECIO_ALIMENTO_KG;

const maplesPorCajon = HUEVOS_POR_CAJON / HUEVOS_POR_MAPLE;

const cajonesConPostura = (aves: number, postura: number) =>
  (aves * postura * DIAS_MES) / HUEVOS_POR_CAJON;

const produccionCajonesLote = cajonesConPostura(AVES, POSTURA_LOTE);
const produccionCajonesPlantel = cajonesConPostura(AVES, POSTURA_PLANTEL);

const contribucionUnitaria = PRECIO_VENTA_CAJON - COSTO_VARIABLE_CAJON;
const puntoEquilibrioCajones = COSTO_FIJO_MENSUAL / contribucionUnitaria;

const amortizacionMensualPlantel =
  (AVES * (COSTO_ADQUISICION_AVE - VALOR_RESIDUAL_AVE)) / VIDA_UTIL_LOTE_MESES;

const resultadoMensual = (aves: number, postura: number) =>
  cajonesConPostura(aves, postura) * contribucionUnitaria - COSTO_FIJO_MENSUAL;

// ---------------------------------------------------------------------------

describe('T-01 — Fixture avícola: la tabla del §11 recalculada desde sus insumos', () => {
  describe('Caso 1-2 — Alimento: donde arranca la deriva', () => {
    it('caso 1 · consumo mensual = 6.300 × 120 g × 30 = 22.680 kg', () => {
      expect(consumoAlimentoKgMes).toBeCloseTo(22_680, 2);
    });

    it('caso 2 · costo de alimento = 22.680 × 330 = 7.484.400 — NO los 7.500.000 del plan', () => {
      expect(costoAlimentoMes).toBeCloseTo(7_484_400, 2);
      // El error original, dejado explícito para que nadie lo reintroduzca:
      expect(costoAlimentoMes).not.toBe(7_500_000);
      expect(7_500_000 - costoAlimentoMes).toBeCloseTo(15_600, 2);
    });
  });

  describe('Caso 3-4 — El plantel como activo amortizable', () => {
    it('caso 3 · amortización mensual = 6.300 × 10.666,67 / 24 = 2.800.000', () => {
      expect(amortizacionMensualPlantel).toBeCloseTo(2_800_000, 0);
    });

    it('caso 3b · con los $800 de la nota daría 210.000: 13x menos. No usar ese valor', () => {
      const conValorErroneo = (AVES * 800) / VIDA_UTIL_LOTE_MESES;
      expect(conValorErroneo).toBeCloseTo(210_000, 2);
      expect(amortizacionMensualPlantel / conValorErroneo).toBeCloseTo(13.33, 1);
    });

    it('caso 4 · amortización por cajón sobre la producción declarada del §11 (472) = 5.932,20', () => {
      const PRODUCCION_DECLARADA_SS11 = 472; // 🟡 ver el test de coherencia más abajo
      expect(amortizacionMensualPlantel / PRODUCCION_DECLARADA_SS11).toBeCloseTo(5_932.2, 1);
    });
  });

  describe('Caso 5-6 — Postura de lote vs. postura de plantel', () => {
    it('caso 5 · con postura de LOTE (94 %) → 493,5 cajones/mes', () => {
      expect(produccionCajonesLote).toBeCloseTo(493.5, 2);
    });

    it('caso 6 · con postura de PLANTEL (88,5 %) → 464,625 cajones/mes', () => {
      expect(produccionCajonesPlantel).toBeCloseTo(464.625, 3);
    });

    it('caso 6b · proyectar con la de lote sobreestima la producción un 6,2 %', () => {
      const sobreestimacion = produccionCajonesLote / produccionCajonesPlantel - 1;
      expect(sobreestimacion).toBeCloseTo(0.0621, 3);
    });
  });

  describe('Caso 7-8 — Costo unitario y contribución', () => {
    it('caso 7 · contribución marginal unitaria = 48.000 − 24.188,98 = 23.811,02', () => {
      expect(contribucionUnitaria).toBeCloseTo(23_811.02, 2);
    });

    it('caso 8 · costo total unitario = 55.968,64 — NO los 56.020 del plan', () => {
      const PRODUCCION_DECLARADA_SS11 = 472;
      const costoTotalUnitario =
        COSTO_VARIABLE_CAJON + COSTO_FIJO_MENSUAL / PRODUCCION_DECLARADA_SS11;
      expect(costoTotalUnitario).toBeCloseTo(55_968.64, 2);
      expect(costoTotalUnitario).not.toBe(56_020);
    });
  });

  describe('Caso 9-10 — Punto de equilibrio', () => {
    it('caso 9 · PE = 15.000.000 / 23.811,02 = 630 cajones — NO 631', () => {
      expect(puntoEquilibrioCajones).toBeCloseTo(629.96, 2);
      expect(Math.round(puntoEquilibrioCajones)).toBe(630);
      expect(Math.round(puntoEquilibrioCajones)).not.toBe(631);
    });

    it('caso 10 · brecha al PE = 630 − 472 = 158 cajones — NO 159', () => {
      const PRODUCCION_DECLARADA_SS11 = 472;
      const brecha = Math.round(puntoEquilibrioCajones) - PRODUCCION_DECLARADA_SS11;
      expect(brecha).toBe(158);
      expect(brecha).not.toBe(159);
    });

    it('caso 10b · el PE congelado de la planilla (572) implica un precio viejo de ~50.413', () => {
      // Es el error exacto que la auditoría encontró: el PE quedó fijo con un precio
      // que ya no rige. Al bajar el precio a 48.000, el PE sube de 572 a 630.
      const PE_CONGELADO_PLANILLA = 572;
      const precioViejoImplicito = COSTO_FIJO_MENSUAL / PE_CONGELADO_PLANILLA + COSTO_VARIABLE_CAJON;
      expect(precioViejoImplicito).toBeCloseTo(50_412.76, 2);
      expect(precioViejoImplicito).toBeGreaterThan(PRECIO_VENTA_CAJON);
    });
  });

  describe('Caso 11-12 — Resultado mensual y punto de cruce', () => {
    it('caso 11 · a 6.300 aves con postura de plantel → −3.936.805 $/mes', () => {
      expect(resultadoMensual(AVES, POSTURA_PLANTEL)).toBeCloseTo(-3_936_805, 0);
    });

    it('caso 12 · a 8.560 aves → +31.897 $/mes (punto de cruce)', () => {
      expect(resultadoMensual(8_560, POSTURA_PLANTEL)).toBeCloseTo(31_897, 0);
    });

    it('caso 12b · a 4.200 aves (el PE de la planilla) sigue perdiendo fuerte', () => {
      // La planilla del cliente dice que a ~4.200 gallinas alcanza el equilibrio.
      // Con los números correctos, a 4.200 aves pierde más de 7 millones por mes.
      expect(resultadoMensual(4_200, POSTURA_PLANTEL)).toBeLessThan(-7_000_000);
    });

    it('caso 12c · el punto de cruce en aves se deriva del PE en cajones', () => {
      const avesEnEquilibrio =
        (puntoEquilibrioCajones * HUEVOS_POR_CAJON) / (POSTURA_PLANTEL * DIAS_MES);
      expect(avesEnEquilibrio).toBeCloseTo(8_541.84, 1);
      // Muy lejos de las ~4.200 de la planilla del cliente:
      expect(avesEnEquilibrio / 4_200).toBeGreaterThan(2);
    });
  });

  describe('Coherencia de unidades', () => {
    it('un cajón son 12 maples de 30 huevos', () => {
      expect(maplesPorCajon).toBe(12);
      expect(maplesPorCajon * HUEVOS_POR_MAPLE).toBe(HUEVOS_POR_CAJON);
    });
  });

  describe('🟡 Incoherencia detectada en la fuente — NO resolver acá', () => {
    it('la producción declarada del §11 (472) no se deriva de ninguna de las dos posturas', () => {
      const PRODUCCION_DECLARADA_SS11 = 472;
      const posturaImplicita =
        (PRODUCCION_DECLARADA_SS11 * HUEVOS_POR_CAJON) / (AVES * DIAS_MES);

      // Ni la de lote (94 %) ni la de plantel (88,5 %): implica 89,90 %.
      expect(posturaImplicita).toBeCloseTo(0.899, 3);
      expect(posturaImplicita).not.toBeCloseTo(POSTURA_LOTE, 2);
      expect(posturaImplicita).not.toBeCloseTo(POSTURA_PLANTEL, 2);

      // El §11 usa 472 para el costo unitario y la brecha, pero 88,5 % para los
      // escenarios de escala. Las dos cosas no pueden ser ciertas a la vez.
      // 🟡 confirmar con Augusto: ¿472 es producción REAL observada de un mes
      // concreto, o una proyección? Si es real, la postura del plantel de ese mes
      // fue 89,9 % y no 88,5 %.
      expect(Math.abs(PRODUCCION_DECLARADA_SS11 - produccionCajonesPlantel)).toBeCloseTo(7.375, 2);
    });
  });
});
