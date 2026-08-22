import { describe, it, expect } from 'vitest';

/**
 * FIXTURE AVÍCOLA — T-01.
 *
 * ⚠️ DATOS FICTICIOS. Este repositorio es público: los números de un cliente real no
 * entran acá. Los valores de abajo son inventados y no corresponden a ninguna
 * explotación existente. El caso real, con sus cifras y su verificación, vive en el
 * repositorio privado (`CosteAR-admin`, `docs/verticales/`).
 *
 * Lo que se prueba es la MATEMÁTICA, y esa es la misma con cualquier número.
 *
 * Por qué existe este archivo
 * ---------------------------
 * La tabla de aceptación del plan avícola venía calculada a mano y NO cerraba con sus
 * propios insumos: el costo del alimento estaba redondeado, y esa deriva se arrastraba
 * al costo variable unitario, al costo total unitario, al punto de equilibrio y a la
 * brecha. Si alguien escribiera los tests contra una tabla así, una implementación
 * CORRECTA los haría fallar.
 *
 * Cómo está escrito
 * -----------------
 * Todos los insumos se declaran como constantes nombradas y **todo valor esperado se
 * deriva de ellas**. No hay un solo número mágico. Si mañana cambia el gramaje o el
 * precio del alimento, se cambia la constante y el fixture sigue siendo verdad.
 *
 * Esto es SOLO tests: no toca el motor de cálculo.
 */

// ---------------------------------------------------------------------------
// INSUMOS DECLARADOS — ficticios
// ---------------------------------------------------------------------------

/** Aves en producción. */
const AVES = 5_000;

/** Gramos de alimento por ave por día. */
const GRAMAJE_G_DIA = 110;

/** Días del mes de costeo. */
const DIAS_MES = 30;

/** Precio del alimento por kg. */
const PRECIO_ALIMENTO_KG = 400;

/** Un cajón son 360 huevos. Es la unidad de gestión del rubro. */
const HUEVOS_POR_CAJON = 360;

/** Un maple son 30 huevos. */
const HUEVOS_POR_MAPLE = 30;

/**
 * Postura medida sobre el LOTE activo: solo las aves que están poniendo.
 * Es la que se suele usar para proyectar — y por eso sobreestima.
 */
const POSTURA_LOTE = 0.92;

/**
 * Postura medida sobre el PLANTEL completo: incluye las aves que no ponen
 * (reposición, descarte pendiente, mortandad del período). Es la que sirve para
 * proyectar.
 */
const POSTURA_PLANTEL = 0.87;

/** Costo fijo mensual de la estructura. */
const COSTO_FIJO_MENSUAL = 12_000_000;

/** Costo variable por cajón. */
const COSTO_VARIABLE_CAJON = 26_000;

/** Precio promedio de venta por cajón. */
const PRECIO_VENTA_CAJON = 52_000;

/**
 * Costo de adquisición por ave.
 *
 * El plantel es un ACTIVO, no un insumo del período: se compra una vez y produce
 * durante meses. Ver `src/domain/parametros/activo-amortizable.ts`.
 */
const COSTO_ADQUISICION_AVE = 9_000;

/**
 * Vida útil del lote, en meses.
 *
 * En producción sale de `ParametroCosteo` (`vida_util_lote_meses`), nunca de una
 * constante: divide la amortización de todo el plantel.
 */
const VIDA_UTIL_LOTE_MESES = 24;

/** Valor residual del ave al final de su vida útil (venta de descarte). */
const VALOR_RESIDUAL_AVE = 0;

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

/** Producción del período, en cajones enteros. */
const PRODUCCION_CAJONES = Math.round(produccionCajonesPlantel);

const contribucionUnitaria = PRECIO_VENTA_CAJON - COSTO_VARIABLE_CAJON;
const puntoEquilibrioCajones = COSTO_FIJO_MENSUAL / contribucionUnitaria;

const amortizacionMensualPlantel =
  (AVES * (COSTO_ADQUISICION_AVE - VALOR_RESIDUAL_AVE)) / VIDA_UTIL_LOTE_MESES;

const resultadoMensual = (aves: number, postura: number) =>
  cajonesConPostura(aves, postura) * contribucionUnitaria - COSTO_FIJO_MENSUAL;

// ---------------------------------------------------------------------------

describe('T-01 — Fixture avícola: cada valor derivado de sus insumos', () => {
  describe('Alimento: donde arrancaba la deriva del plan', () => {
    it('consumo mensual = aves × gramaje × días', () => {
      expect(consumoAlimentoKgMes).toBeCloseTo(16_500, 2);
    });

    it('costo de alimento = consumo × precio, sin redondear', () => {
      expect(costoAlimentoMes).toBeCloseTo(6_600_000, 2);
      // La lección del plan original: redondear acá arrastra el error hasta el
      // punto de equilibrio. El valor se deriva, no se escribe a mano.
      expect(costoAlimentoMes).toBe(consumoAlimentoKgMes * PRECIO_ALIMENTO_KG);
    });
  });

  describe('El plantel como activo amortizable', () => {
    it('amortización mensual = (costo − residual) / vida útil', () => {
      expect(amortizacionMensualPlantel).toBeCloseTo(1_875_000, 0);
    });

    it('amortización por cajón producido', () => {
      expect(amortizacionMensualPlantel / PRODUCCION_CAJONES).toBeCloseTo(5_165.29, 2);
    });

    it('🔒 la vida útil NO está hardcodeada: al acortarla, la cuota sube', () => {
      const con18 =
        (AVES * (COSTO_ADQUISICION_AVE - VALOR_RESIDUAL_AVE)) / 18;
      expect(con18).toBeGreaterThan(amortizacionMensualPlantel);
      expect(con18 / amortizacionMensualPlantel).toBeCloseTo(24 / 18, 4);
    });
  });

  describe('Postura de lote vs. postura de plantel', () => {
    it('con postura de LOTE la producción proyectada es mayor', () => {
      expect(produccionCajonesLote).toBeCloseTo(383.333, 3);
    });

    it('con postura de PLANTEL, que es la que sirve para proyectar', () => {
      expect(produccionCajonesPlantel).toBeCloseTo(362.5, 3);
    });

    it('proyectar con la de lote sobreestima la producción un 5,75 %', () => {
      // Es el error que hace que una explotación crea que llega al equilibrio
      // antes de lo que llega.
      expect(produccionCajonesLote / produccionCajonesPlantel - 1).toBeCloseTo(0.0575, 4);
    });
  });

  describe('Costo unitario y contribución', () => {
    it('contribución marginal unitaria = precio − costo variable', () => {
      expect(contribucionUnitaria).toBeCloseTo(26_000, 2);
    });

    it('costo total unitario = variable + fijo / producción', () => {
      const costoTotalUnitario = COSTO_VARIABLE_CAJON + COSTO_FIJO_MENSUAL / PRODUCCION_CAJONES;
      expect(costoTotalUnitario).toBeCloseTo(59_057.85, 2);
      // Con este precio de venta, la explotación pierde en cada cajón.
      expect(costoTotalUnitario).toBeGreaterThan(PRECIO_VENTA_CAJON);
    });
  });

  describe('Punto de equilibrio', () => {
    it('PE = costo fijo / contribución unitaria', () => {
      expect(puntoEquilibrioCajones).toBeCloseTo(461.54, 2);
      expect(Math.round(puntoEquilibrioCajones)).toBe(462);
    });

    it('brecha al PE = PE − producción', () => {
      expect(Math.round(puntoEquilibrioCajones) - PRODUCCION_CAJONES).toBe(99);
    });

    it('🚨 el PE se RECALCULA: un precio viejo lo deja congelado y mintiendo', () => {
      // El error clásico de las planillas: el PE queda fijo con un precio que ya
      // no rige. Si el precio baja, el PE real sube y la planilla no se entera.
      const precioViejo = PRECIO_VENTA_CAJON * 1.08;
      const peConPrecioViejo = COSTO_FIJO_MENSUAL / (precioViejo - COSTO_VARIABLE_CAJON);

      expect(peConPrecioViejo).toBeLessThan(puntoEquilibrioCajones);
      // Creer el PE viejo es creerse más cerca del equilibrio de lo que se está.
      expect(puntoEquilibrioCajones - peConPrecioViejo).toBeGreaterThan(30);
    });
  });

  describe('Resultado mensual y punto de cruce', () => {
    it('a la escala actual, el resultado es negativo', () => {
      expect(resultadoMensual(AVES, POSTURA_PLANTEL)).toBeCloseTo(-2_575_000, 0);
    });

    it('el punto de cruce está bastante más arriba que la escala actual', () => {
      const avesEnEquilibrio =
        (puntoEquilibrioCajones * HUEVOS_POR_CAJON) / (POSTURA_PLANTEL * DIAS_MES);

      expect(avesEnEquilibrio).toBeCloseTo(6_366.05, 1);
      expect(resultadoMensual(6_367, POSTURA_PLANTEL)).toBeGreaterThan(0);
      expect(resultadoMensual(6_366, POSTURA_PLANTEL)).toBeLessThan(0);
    });

    it('a la mitad de la escala de equilibrio, la pérdida es mucho mayor', () => {
      expect(resultadoMensual(3_200, POSTURA_PLANTEL)).toBeLessThan(-5_000_000);
    });
  });

  describe('Coherencia de unidades', () => {
    it('un cajón son 12 maples de 30 huevos', () => {
      expect(maplesPorCajon).toBe(12);
      expect(maplesPorCajon * HUEVOS_POR_MAPLE).toBe(HUEVOS_POR_CAJON);
    });
  });
});
