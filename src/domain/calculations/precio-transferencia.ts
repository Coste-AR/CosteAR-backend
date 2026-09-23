import { Decimal } from 'decimal.js';

export type CriterioTransferencia = 'MERCADO' | 'COSTO_VARIABLE' | 'PRECIO_EN_BLOQUE';

export function calcularPrecioTransferencia(input: {
  precioVenta: number; costoVariableSinTransferencia: number; costoFijo: number;
  transferenciaACostoVariable: number; transferenciaAMercado: number; unidad: string;
  criterioSolicitadoParaDecision?: CriterioTransferencia;
}) {
  const equilibrio = (transferencia: number) => new Decimal(input.costoFijo).div(
    new Decimal(input.precioVenta).minus(input.costoVariableSinTransferencia).minus(transferencia),
  );
  const aCosto = equilibrio(input.transferenciaACostoVariable);
  const aMercado = equilibrio(input.transferenciaAMercado);
  return {
    equilibrioACostoVariable: aCosto.toNumber(), equilibrioAMercado: aMercado.toNumber(),
    diferencia: aMercado.minus(aCosto).toDecimalPlaces(6).toNumber(),
    criterioDecisionMarginal: 'COSTO_VARIABLE' as const,
    avisoDecisionMarginal: input.criterioSolicitadoParaDecision === 'MERCADO'
      ? 'Se pidió mercado para una decisión marginal; se usa costo variable para no convertir un precio interno en costo real.'
      : 'Las decisiones marginales usan costo variable (R9).',
    usoDeCadaCriterio: { COSTO_VARIABLE: 'Decisiones marginales (R9).', MERCADO: 'Estado de resultados por sector (R24).' },
    unidades: { equilibrioACostoVariable: input.unidad, equilibrioAMercado: input.unidad, diferencia: input.unidad },
  };
}
