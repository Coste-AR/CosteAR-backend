import { Decimal } from 'decimal.js';
import { ProcessValidationError } from '../errors/calculation-errors.js';

/**
 * COSTOS CONJUNTOS · REPARTO ENTRE PRODUCTOS DEL PUNTO DE SEPARACIÓN (B11)
 *
 * En un "punto de separación" un mismo proceso rinde VARIOS productos a partir de
 * un costo compartido: el COSTO CONJUNTO. Costo conjunto = materia prima + costos
 * de conversión acumulados hasta el punto de separación (el TODO, no solo la
 * conversión). Ese costo hay que distribuirlo entre las líneas de producto
 * (coproductos, subproductos, desechos) que emergen en el punto de separación.
 *
 * NINGÚN método es "el correcto": el costo conjunto es, por definición, común e
 * indivisible, así que cualquier reparto es convencional. El usuario ELIGE el
 * método y cada uno da un costo unitario DISTINTO. La cátedra usa cuatro:
 *
 *   PHYSICAL_UNITS       — unidades físicas (costo uniforme por unidad).
 *   TECHNICAL_YIELD      — factor técnico (rendimientos dados).
 *   MARKET_VALUE         — valor de mercado en el punto de separación.
 *   NET_REALIZABLE_VALUE — valor neto de realización (VNR) — el más usado.
 *
 * Los cuatro comparten la MISMA firma `(products, jointCostTotal) → resultado` y
 * la misma forma de resolver una vez calculada la "base de reparto" de cada
 * método: participación = base ÷ Σ bases; costo asignado = participación × costo
 * conjunto total; costo unitario = costo asignado ÷ unidades. El dispatcher
 * `allocateJointCosts` elige la función según el método.
 *
 * Funciones PURAS: sin Prisma, sin HTTP, sin servicios. Lanzan
 * `ProcessValidationError` (422) con mensaje accionable en español ante cualquier
 * dato que impida repartir — nunca un 500 crudo. Los nombres de campo replican
 * los de la tabla `ByProductLine` (B05) para que el motor de Procesos (B17) mapee
 * de la fila persistida a esta función sin traducir.
 *
 * Metodología de la Cátedra de Costos (UNT). Casos ancla FX-J1 en DECISIONES.md.
 */

/** Método de reparto elegido. Replica el enum `JointAllocationMethod` (B05). */
export type JointAllocationMethod =
  | 'PHYSICAL_UNITS'
  | 'TECHNICAL_YIELD'
  | 'MARKET_VALUE'
  | 'NET_REALIZABLE_VALUE';

/**
 * Una línea de producto que sale del punto de separación. Trae TODOS los campos
 * posibles (como la tabla `ByProductLine`); cada método usa el subconjunto que
 * necesita y valida que estén los suyos. Cantidades y precios en las mismas
 * unidades entre líneas.
 */
export interface JointProduct {
  /** Nombre de la línea (coproducto/subproducto/desecho). Se muestra al costista. */
  productName: string;
  /**
   * Unidades buenas obtenidas de la línea en el punto de separación. En el método
   * de factor técnico, son los "kilos obtenidos" (kg MP × % rendimiento). Es el
   * denominador del costo unitario en TODOS los métodos, así que debe ser > 0.
   */
  unitsObtained: Decimal.Value;
  /**
   * Rendimiento técnico de la línea — SOLO `TECHNICAL_YIELD`. Se usa como base
   * PROPORCIONAL: da igual fracción (0.06) o porcentaje (6) mientras sea
   * consistente entre líneas, porque los kg de MP son un factor común que se
   * cancela en la participación (ver DECISIONES.md B11).
   */
  yieldPct?: Decimal.Value;
  /** Precio de mercado en el punto de separación — `MARKET_VALUE` y `NET_REALIZABLE_VALUE`. */
  marketPrice?: Decimal.Value;
  /** Gasto de comercialización VARIABLE, como FRACCIÓN del precio (0.03 = 3 %) — solo VNR. Default 0. */
  sellingCostVarPct?: Decimal.Value;
  /** Gasto de comercialización FIJO por unidad ($/unidad) — solo VNR. Default 0. */
  sellingCostFixedPerUnit?: Decimal.Value;
}

/** Una línea de producto ya con su costo conjunto asignado. */
export interface JointCostAllocationLine {
  /** Nombre de la línea (tal cual entró). */
  productName: string;
  /** Unidades buenas obtenidas (denominador del costo unitario). */
  unitsObtained: Decimal;
  /**
   * Base de reparto de la línea SEGÚN EL MÉTODO: unidades (físicas), rendimiento
   * (factor técnico), valor de mercado (unidades × precio) o VNR.
   */
  allocationBase: Decimal;
  /** % de participación en el costo conjunto = base ÷ Σ bases. Fracción [0, 1]. */
  participationPct: Decimal;
  /** Costo conjunto asignado = participación × costo conjunto total. */
  allocatedCost: Decimal;
  /** Costo unitario = costo asignado ÷ unidades obtenidas. */
  unitCost: Decimal;
}

/** Reparto completo del costo conjunto entre las líneas de producto. */
export interface JointCostAllocationResult {
  /** Método aplicado. */
  method: JointAllocationMethod;
  /** Costo conjunto total repartido. */
  jointCostTotal: Decimal;
  /** Una línea por producto, en el orden en que entraron. */
  lines: JointCostAllocationLine[];
  /** Σ de los costos asignados. CONTROL: debe igualar el costo conjunto total. */
  totalAllocated: Decimal;
}

/**
 * Tolerancia (en pesos) del control Σ costos asignados = costo conjunto total. El
 * reparto es exacto por construcción (Σ participaciones = 1 ⇒ Σ asignados =
 * total); esta cota solo absorbe el residuo de redondear las participaciones al
 * dividir. Un desvío mayor delataría un error de programación, no de datos.
 */
const ALLOCATION_COST_TOLERANCE = new Decimal('0.01');

/** Tolerancia del control Σ participaciones = 100 %. Mismo espíritu, en fracción. */
const PARTICIPATION_TOLERANCE = new Decimal('1e-9');

/** `undefined`/`null` → sin dato; en otro caso, a Decimal. */
function opt(value: Decimal.Value | undefined | null): Decimal | undefined {
  return value === undefined || value === null ? undefined : new Decimal(value);
}

/** Igual que `opt`, pero con default cuando no hay dato. */
function withDefault(value: Decimal.Value | undefined | null, fallback: number): Decimal {
  return opt(value) ?? new Decimal(fallback);
}

/** Exige que un campo obligatorio del método esté presente; si no, 422 accionable. */
function required(value: Decimal.Value | undefined | null, productName: string, field: string, label: string): Decimal {
  const parsed = opt(value);
  if (parsed === undefined) {
    throw new ProcessValidationError(
      `Falta ${label} del producto "${productName}", obligatorio para este método de reparto. Cargá el dato de la línea.`,
      { field, productName },
    );
  }
  return parsed;
}

/**
 * Núcleo compartido por los cuatro métodos: dada la BASE DE REPARTO de cada línea
 * (lo único que cambia entre métodos), computa participaciones, costos asignados y
 * costos unitarios, y verifica los dos controles de la cátedra (Σ participaciones
 * = 100 % y Σ asignados = costo conjunto total). Función interna: los métodos
 * públicos solo aportan su `baseOf`.
 */
function allocate(
  method: JointAllocationMethod,
  products: readonly JointProduct[],
  jointCostTotal: Decimal.Value,
  baseOf: (product: JointProduct, units: Decimal) => Decimal,
): JointCostAllocationResult {
  if (products.length === 0) {
    throw new ProcessValidationError(
      'No hay productos en el punto de separación: no se puede repartir el costo conjunto. Cargá al menos una línea de producto.',
      { field: 'products' },
    );
  }

  const total = new Decimal(jointCostTotal);
  if (total.isNegative()) {
    throw new ProcessValidationError(
      `El costo conjunto total (${total.toString()}) no puede ser negativo. Es materia prima + costos de conversión hasta el punto de separación.`,
      { field: 'jointCostTotal' },
    );
  }

  // Unidades y base de cada línea (la base valida los campos propios del método).
  const bases = products.map((product) => {
    const units = required(product.unitsObtained, product.productName, 'unitsObtained', 'las unidades obtenidas');
    if (units.lte(0)) {
      throw new ProcessValidationError(
        `El producto "${product.productName}" tiene ${units.toString()} unidades obtenidas: deben ser mayores que 0 para repartir el costo conjunto y calcular el costo unitario.`,
        { field: 'unitsObtained', productName: product.productName },
      );
    }
    return { product, units, base: baseOf(product, units) };
  });

  // Σ bases: es el denominador del reparto. En 0 (o negativo) no hay cómo repartir.
  const totalBase = bases.reduce((acc, b) => acc.plus(b.base), new Decimal(0));
  if (totalBase.lte(0)) {
    throw new ProcessValidationError(
      `La base de reparto total del método es ${totalBase.toString()} (debe ser > 0): con esa base no se puede distribuir el costo conjunto. Revisá los datos de las líneas (unidades, rendimientos, precios o gastos de comercialización).`,
      { field: 'products', method, totalBase: totalBase.toNumber() },
    );
  }

  const lines: JointCostAllocationLine[] = bases.map(({ product, units, base }) => {
    const participationPct = base.div(totalBase);
    const allocatedCost = participationPct.times(total);
    return {
      productName: product.productName,
      unitsObtained: units,
      allocationBase: base,
      participationPct,
      allocatedCost,
      // units > 0 garantizado arriba, así que la división es segura.
      unitCost: allocatedCost.div(units),
    };
  });

  const totalAllocated = lines.reduce((acc, l) => acc.plus(l.allocatedCost), new Decimal(0));
  assertAllocationConsistency(method, lines, total, totalAllocated);

  return { method, jointCostTotal: total, lines, totalAllocated };
}

/**
 * Controles de la cátedra sobre el reparto ya calculado: Σ participaciones = 100 %
 * y Σ costos asignados = costo conjunto total (ambos dentro de una tolerancia de
 * redondeo). Se cumplen por construcción; que fallen sería un error de
 * programación, no de datos, y se corta con un 422 en vez de devolver un reparto
 * que no cuadra.
 */
function assertAllocationConsistency(
  method: JointAllocationMethod,
  lines: JointCostAllocationLine[],
  jointCostTotal: Decimal,
  totalAllocated: Decimal,
): void {
  const totalPct = lines.reduce((acc, l) => acc.plus(l.participationPct), new Decimal(0));
  if (totalPct.minus(1).abs().gt(PARTICIPATION_TOLERANCE)) {
    throw new ProcessValidationError(
      `El reparto (${method}) no cierra: la suma de participaciones da ${totalPct.times(100).toString()} %, no 100 %.`,
      { field: 'products', method, sumaParticipaciones: totalPct.toNumber() },
    );
  }

  const difference = totalAllocated.minus(jointCostTotal);
  if (difference.abs().gt(ALLOCATION_COST_TOLERANCE)) {
    throw new ProcessValidationError(
      `El reparto (${method}) no cierra: la suma de los costos asignados (${totalAllocated.toString()}) ≠ costo conjunto total (${jointCostTotal.toString()}). Diferencia: ${difference.toString()}.`,
      { field: 'jointCostTotal', method, totalAllocated: totalAllocated.toNumber(), jointCostTotal: jointCostTotal.toNumber() },
    );
  }
}

/**
 * MÉTODO 1 · UNIDADES FÍSICAS — costo uniforme por unidad.
 *
 *   base(p)          = unidades del producto
 *   costo por unidad = jointCostTotal ÷ Σ unidades buenas (todos los productos)
 *   costo asignado(p) = costo por unidad × unidades(p)
 *
 * El desperdicio (unidades que NO son producto) simplemente no se incluye en
 * `products`, así que no participa del reparto (caso ancla M1).
 *
 * Ancla M1: jointCostTotal $570.000; A 2.500 kg, B 3.000, C 4.000 (buenas 9.500;
 * desperdicio 500 no listado) → $60/kg → A $150.000, B $180.000, C $240.000.
 */
export function allocateByPhysicalUnits(
  products: readonly JointProduct[],
  jointCostTotal: Decimal.Value,
): JointCostAllocationResult {
  return allocate('PHYSICAL_UNITS', products, jointCostTotal, (_product, units) => units);
}

/**
 * MÉTODO 2 · FACTOR TÉCNICO — reparto por rendimientos dados (nunca inventados).
 *
 *   kilos obtenidos(p) = kg de MP × % rendimiento(p)
 *   % participación(p) = kilos obtenidos(p) ÷ Σ kilos obtenidos
 *   costo asignado(p)  = % participación(p) × jointCostTotal
 *
 * Los kg de MP son un FACTOR COMÚN a todas las líneas, así que se cancelan en la
 * participación: la base de reparto es directamente el rendimiento `yieldPct` (ver
 * DECISIONES.md B11). Las `unitsObtained` de la línea son esos kilos obtenidos y
 * hacen de denominador del costo unitario.
 *
 * Ancla M2: MP 1.000 kg; rendimientos Jugo 6 %, Aceite 0,50 %, Cáscara 5 % →
 * 60/5/50 kg (total 115) → participaciones 52,17 % / 4,35 % / 43,48 %.
 */
export function allocateByTechnicalYield(
  products: readonly JointProduct[],
  jointCostTotal: Decimal.Value,
): JointCostAllocationResult {
  return allocate('TECHNICAL_YIELD', products, jointCostTotal, (product) =>
    required(product.yieldPct, product.productName, 'yieldPct', 'el rendimiento técnico'),
  );
}

/**
 * MÉTODO 3 · VALOR DE MERCADO en el punto de separación (SIN gastos de
 * comercialización).
 *
 *   valor de mercado(p) = unidades(p) × precio de mercado(p)
 *   % participación(p)  = valor de mercado(p) ÷ Σ valor de mercado
 *   costo asignado(p)   = % participación(p) × jointCostTotal
 *
 * Ancla M3: jointCostTotal $570.000; A 2.500×$120=$300.000, B 3.000×$170=$510.000,
 * C 4.000×$225=$900.000 (base $1.710.000) → A $100.000 ($40/kg), B $170.000
 * ($56,67/kg), C $300.000 ($75/kg).
 */
export function allocateByMarketValue(
  products: readonly JointProduct[],
  jointCostTotal: Decimal.Value,
): JointCostAllocationResult {
  return allocate('MARKET_VALUE', products, jointCostTotal, (product, units) => {
    const marketPrice = required(product.marketPrice, product.productName, 'marketPrice', 'el precio de mercado');
    return units.times(marketPrice);
  });
}

/**
 * MÉTODO 4 · VALOR NETO DE REALIZACIÓN (VNR) — el más usado.
 *
 *   VNR(p)             = (unidades(p) × precio(p)) − gastos de comercialización(p)
 *   gastos de com.(p)  = variables (% sobre el precio) + fijos ($/unidad)
 *   % participación(p) = VNR(p) ÷ Σ VNR
 *   costo asignado(p)  = % participación(p) × jointCostTotal
 *
 * Los gastos variables se computan como fracción del VALOR DE VENTA (unidades ×
 * precio), que es equivalente a "% sobre el precio" línea a línea. Un VNR negativo
 * (los gastos de comercialización superan al valor de venta) es un dato imposible
 * de repartir y se corta con un 422 accionable.
 *
 * Ancla M4: jointCostTotal $110.000; var 3 %, fija $10/kg; A 200×$300, B 300×$400,
 * C 400×$500 → VNR A $56.200, B $113.400, C $190.000 (total $359.600) → A
 * $17.191,32 ($85,96/kg), B $34.688,54, C $58.120,13.
 */
export function allocateByNetRealizableValue(
  products: readonly JointProduct[],
  jointCostTotal: Decimal.Value,
): JointCostAllocationResult {
  return allocate('NET_REALIZABLE_VALUE', products, jointCostTotal, (product, units) => {
    const marketPrice = required(product.marketPrice, product.productName, 'marketPrice', 'el precio de mercado');
    const salesValue = units.times(marketPrice);
    const variableSellingCost = salesValue.times(withDefault(product.sellingCostVarPct, 0));
    const fixedSellingCost = units.times(withDefault(product.sellingCostFixedPerUnit, 0));
    const vnr = salesValue.minus(variableSellingCost).minus(fixedSellingCost);
    if (vnr.isNegative()) {
      throw new ProcessValidationError(
        `El producto "${product.productName}" tiene VNR negativo (${vnr.toString()}): los gastos de comercialización superan su valor de venta (${salesValue.toString()}). No puede absorber costo conjunto; revisá el precio o los gastos, o tratalo como subproducto/desecho.`,
        { field: 'sellingCostVarPct', productName: product.productName, vnr: vnr.toNumber() },
      );
    }
    return vnr;
  });
}

/**
 * DISPATCHER · reparte el costo conjunto entre los productos del punto de
 * separación con el método elegido por el usuario. Único punto de entrada del
 * motor de Procesos (B17): dado el método persistido, delega a la función pura
 * correspondiente. Lanza `ProcessValidationError` (422) si el método es
 * desconocido — nunca un 500.
 */
export function allocateJointCosts(
  products: readonly JointProduct[],
  method: JointAllocationMethod,
  jointCostTotal: Decimal.Value,
): JointCostAllocationResult {
  switch (method) {
    case 'PHYSICAL_UNITS':
      return allocateByPhysicalUnits(products, jointCostTotal);
    case 'TECHNICAL_YIELD':
      return allocateByTechnicalYield(products, jointCostTotal);
    case 'MARKET_VALUE':
      return allocateByMarketValue(products, jointCostTotal);
    case 'NET_REALIZABLE_VALUE':
      return allocateByNetRealizableValue(products, jointCostTotal);
    default:
      throw new ProcessValidationError(
        `Método de reparto de costos conjuntos desconocido: "${String(method)}". Debe ser uno de: PHYSICAL_UNITS, TECHNICAL_YIELD, MARKET_VALUE, NET_REALIZABLE_VALUE.`,
        { field: 'method', method: String(method) },
      );
  }
}
