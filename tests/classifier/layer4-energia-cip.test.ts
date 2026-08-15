/**
 * CL-05 — La factura de luz tiene que resolverse sola, sin llegar a la IA.
 *
 * La auditoría del 06/08/2026 midió que una factura de energía eléctrica de los
 * galpones —el costo indirecto más grande de casi cualquier PyME industrial— no
 * matcheaba NINGUNA keyword y caía a la IA, que la mandó a GASTO_ADMINISTRACION
 * con confianza 97 (documento CIP-01 del corpus).
 *
 * Dos causas: faltaban las keywords ('energía eléctrica', 'electricidad', 'kwh')
 * y el regex era `\benergia\b` SIN tilde, así que "Energía eléctrica" —la forma
 * ortográficamente correcta, la que imprime la mayoría de las facturas— no
 * entraba.
 *
 * Regla de la cátedra: Clase 1, l. 64 (los CIP incluyen "energía eléctrica,
 * fuerza motriz, calefacción") y Clase 11, l. 211 ("Energía eléctrica
 * (iluminación y fuerza motriz)").
 *
 * Estos tests son DETERMINISTAS: corren sobre Layer 4, no tocan Groq ni la base.
 * Esa es la gracia — el criterio de aceptación de CL-05 es justamente que el
 * documento NO necesite la IA.
 */
import { describe, it, expect } from 'vitest';
import { runLayer4 } from '@/infrastructure/classifier/layers/layer4-business-routing.js';

const facturaLuz = (detalle: string) => `
FACTURA A
CAE Nº: 75200000000301
CUIT: 30-54668943-1
Proveedor: EDET SA
Fecha: 05/07/2026
${detalle}
`;

describe('Layer 4 — la factura de energía eléctrica se resuelve sin IA (CL-05)', () => {
  it('con tilde: "Energía eléctrica" ahora matchea — era el bug del regex', () => {
    const r = runLayer4('FACTURA_COMPRA', facturaLuz('Energía eléctrica — suministro galpones de postura\nConsumo: 184.500 kWh'));

    expect(r.costSection).toBe('COSTOS_INDIRECTOS');
    expect(r.requiresAI).toBe(false);
  });

  it('sin tilde: "energia electrica" sigue funcionando (no se rompió la forma vieja)', () => {
    const r = runLayer4('FACTURA_COMPRA', facturaLuz('Energia electrica - suministro planta'));

    expect(r.costSection).toBe('COSTOS_INDIRECTOS');
    expect(r.requiresAI).toBe(false);
  });

  it.each([
    ['electricidad', 'Servicio de electricidad del mes'],
    ['kwh', 'Consumo del período: 184.500 kWh'],
    ['KW/h en mayúsculas', 'CONSUMO 12.000 KWH — CARGO VARIABLE'],
  ])('la variante «%s» también resuelve a CIP', (_etiqueta, detalle) => {
    const r = runLayer4('FACTURA_COMPRA', facturaLuz(detalle));

    expect(r.costSection).toBe('COSTOS_INDIRECTOS');
  });

  it('el documento exacto de la auditoría (CIP-01) ya no cae a la IA', () => {
    const r = runLayer4(
      'FACTURA_COMPRA',
      facturaLuz('Energía eléctrica — suministro galpones de postura\nConsumo del período: 184.500 kWh\nCargo fijo y cargo variable por energía'),
      'AGRO', // el perfil con el que se atendía al cliente cuando se midió el error
    );

    expect(r.costSection).toBe('COSTOS_INDIRECTOS');
    expect(r.requiresAI).toBe(false);
    // El error medido fue GASTO_ADMINISTRACION con confianza 97.
    expect(r.costSection).not.toBe('GASTO_ADMINISTRACION');
  });

  it('no se tragó el gas natural ni la luz eléctrica, que ya andaban', () => {
    expect(runLayer4('FACTURA_COMPRA', facturaLuz('Gas natural para proceso de planta')).costSection)
      .toBe('COSTOS_INDIRECTOS');
    expect(runLayer4('FACTURA_COMPRA', facturaLuz('Luz eléctrica de la planta')).costSection)
      .toBe('COSTOS_INDIRECTOS');
  });

  it('LÍMITE CONOCIDO declarado: no distingue la luz de planta de la de oficina', () => {
    // Documentado a proposito en vez de fingir que se resolvió: una factura que
    // solo diga "oficina administrativa" cae igual en CIP, porque esa frase no
    // es una señal de gasto en TRANSVERSAL_GASTO_KEYWORDS (las de administración
    // son especificas: honorarios, papelería, sueldos administrativos...).
    // Si esto se corrige algún día, este test debe cambiar de expectativa.
    const r = runLayer4('FACTURA_COMPRA', facturaLuz('Energía eléctrica — oficina administrativa'));

    expect(r.costSection).toBe('COSTOS_INDIRECTOS');
  });
});
