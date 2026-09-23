import { describe, expect, it } from 'vitest';
import { calcularPrecioTransferencia } from '@/domain/calculations/precio-transferencia.js';

describe('AM-11 — precio de transferencia interna', () => {
  it('muestra ambos equilibrios sin convertir el precio de mercado en costo real', () => {
    expect(calcularPrecioTransferencia({
      precioVenta: 48_000, costoVariableSinTransferencia: 15_000,
      costoFijo: 15_000_000, transferenciaACostoVariable: 2_600,
      transferenciaAMercado: 3_600, unidad: 'cajones',
    })).toMatchObject({
      equilibrioACostoVariable: 493.42105263157896,
      equilibrioAMercado: 510.2040816326531,
      diferencia: 16.783029, criterioDecisionMarginal: 'COSTO_VARIABLE',
    });
  });

  it('fuerza costo variable cuando se pide la decisión marginal con mercado', () => {
    const resultado = calcularPrecioTransferencia({
      precioVenta: 48_000, costoVariableSinTransferencia: 15_000,
      costoFijo: 15_000_000, transferenciaACostoVariable: 2_600,
      transferenciaAMercado: 3_600, unidad: 'cajones', criterioSolicitadoParaDecision: 'MERCADO',
    });
    expect(resultado.criterioDecisionMarginal).toBe('COSTO_VARIABLE');
    expect(resultado.avisoDecisionMarginal).toMatch(/mercado.*costo variable/i);
  });
});
