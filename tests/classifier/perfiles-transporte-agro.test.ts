/**
 * Perfiles TRANSPORTE y AGRO — las dos banderas que mandaban facturas enteras a
 * MATERIA PRIMA sin que la IA las viera.
 *
 * Los dos defectos son el mismo que CL-04 ya había medido y corregido para
 * AVICULTURA, sobrevivientes en otros dos rubros:
 *
 *  · TRANSPORTE tenía `energyIsMP: true` SIN CONDICIÓN. En layer4 esa bandera se
 *    evalúa contra un regex que matchea 'electricidad' / 'luz eléctrica' /
 *    'gas natural' / 'energía', así que la factura de LUZ del depósito de un
 *    transportista salía MATERIA_PRIMA con confianza 85 y `requiresAI: false`.
 *
 *  · AGRO tenía `fuelIsMP: true` y 'vacuna' / 'veterinaria' en mpKeywords. Para
 *    un tambo o un establecimiento ganadero —que caen en AGRO por 'tambo' y
 *    'ganad' en AGRO_RE— eso mandaba a MATERIA PRIMA cada factura de gasoil y
 *    cada factura del veterinario.
 *
 * La regla que ordena las dos correcciones es R-MP-DIRECTA (Clase 1, l. 58):
 * materia prima es lo IDENTIFICABLE CON el objeto de costo. El gasoil mueve el
 * tractor pero no se vuelve grano ni leche; la vacuna sostiene al animal pero no
 * se incorpora al litro; la luz del galpón ilumina pero no viaja en el camión.
 * Todo eso es CIP (Clase 1, l. 64; Clase 11, l. 211).
 *
 * Determinista: Layer 4 puro, sin Groq ni base de datos.
 */
import { describe, it, expect } from 'vitest';
import { runLayer4 } from '@/infrastructure/classifier/layers/layer4-business-routing.js';
import {
  getIndustryProfile,
  categorizeIndustry,
} from '@/infrastructure/classifier/industry/industry-profile.js';

const factura = (proveedor: string, detalle: string) => `
FACTURA A
CAE Nº: 75200000000301
CUIT: 30-54668943-1
Proveedor: ${proveedor}
Fecha: 05/07/2026
${detalle}
`;

describe('TRANSPORTE — la factura de luz deja de ser Materia Prima', () => {
  it('la bandera de energía quedó apagada; la de combustible sigue encendida', () => {
    const p = getIndustryProfile('TRANSPORTE');

    expect(p.energyIsMP).toBe(false);
    expect(p.fuelIsMP).toBe(true);
  });

  it.each([
    ['energía eléctrica', 'Energía eléctrica — suministro del depósito\nConsumo: 4.200 kWh'],
    ['electricidad',      'Servicio de electricidad de la cochera'],
    ['gas natural',       'Gas natural — calefacción de las oficinas'],
  ])('«%s» de un transportista va a Costos Indirectos, no a Materia Prima', (_e, detalle) => {
    const r = runLayer4('FACTURA_COMPRA', factura('EDESUR SA', detalle), 'TRANSPORTE');

    expect(r.costSection).toBe('COSTOS_INDIRECTOS');
    // El error medido era MATERIA_PRIMA con confianza 85 y sin pasar por la IA.
    expect(r.costSection).not.toBe('MATERIA_PRIMA');
    expect(r.requiresAI).toBe(false);
  });

  it('pero el combustible del camión SIGUE siendo Materia Prima (no se rompió el caso legítimo)', () => {
    const r = runLayer4(
      'FACTURA_COMPRA',
      factura('YPF Estación Ruta 9', '400 litros de gasoil para la flota'),
      'TRANSPORTE',
    );

    expect(r.costSection).toBe('MATERIA_PRIMA');
    expect(r.requiresAI).toBe(false);
  });

  it.each([
    ['la sigla', 'Carga de GNC para utilitarios de reparto'],
    ['escrito en largo', 'Gas natural comprimido para la flota de utilitarios'],
  ])('el GNC (%s) también es Materia Prima: era la carga que dependía de la bandera de energía', (_e, detalle) => {
    // `hasFuel` tenía la rama `\bGNC\b` escrita en mayúsculas sobre un texto ya
    // pasado a minúsculas — no matcheaba nunca, y el GNC se salvaba de rebote por
    // `energyIsMP`. Al apagar esa bandera hubo que arreglar el regex y distinguir
    // el gas natural COMPRIMIDO (combustible) del gas natural del depósito (CIP).
    const r = runLayer4('FACTURA_COMPRA', factura('Gas Sur SA', detalle), 'TRANSPORTE');

    expect(r.costSection).toBe('MATERIA_PRIMA');
    expect(r.requiresAI).toBe(false);
  });

  it('neumáticos y repuestos, que nunca dependieron de la energía, siguen igual', () => {
    const r = runLayer4(
      'FACTURA_COMPRA',
      factura('Neumáticos del Litoral', '6 neumáticos 295/80 R22.5 para el semirremolque'),
      'TRANSPORTE',
    );

    expect(r.costSection).toBe('MATERIA_PRIMA');
  });
});

describe('AGRO — el tambo y la ganadería dejan de romperse', () => {
  it('un tambo y un establecimiento ganadero caen en el perfil AGRO (por eso importa)', () => {
    expect(categorizeIndustry('Tambo La Elisa')).toBe('AGRO');
    expect(categorizeIndustry('Establecimiento de ganadería bovina')).toBe('AGRO');
  });

  it('las banderas del perfil quedaron alineadas con AVICULTURA', () => {
    const p = getIndustryProfile('AGRO');

    expect(p.fuelIsMP).toBe(false);
    expect(p.energyIsMP).toBe(false);
    expect(p.mpKeywords).not.toContain('gasoil');
    expect(p.mpKeywords).not.toContain('vacuna');
    expect(p.mpKeywords).not.toContain('veterinaria');
    expect(p.cipKeywords).toContain('gasoil');
    expect(p.cipKeywords).toContain('vacuna');
  });

  it('el gasoil del tractor es fuerza motriz → Costos Indirectos, no Materia Prima', () => {
    const r = runLayer4(
      'FACTURA_COMPRA',
      factura('YPF Agro', '2.000 litros de gasoil para tractores y cosechadora'),
      'AGRO',
    );

    expect(r.costSection).toBe('COSTOS_INDIRECTOS');
    expect(r.costSection).not.toBe('MATERIA_PRIMA');
  });

  it('la factura del veterinario y las vacunas del rodeo son material indirecto → CIP', () => {
    const r = runLayer4(
      'FACTURA_COMPRA',
      factura('Veterinaria San Martín', 'Vacunas antiaftosa y antiparasitario para el rodeo'),
      'AGRO',
    );

    expect(r.costSection).toBe('COSTOS_INDIRECTOS');
    expect(r.costSection).not.toBe('MATERIA_PRIMA');
  });

  it('el alimento del rodeo SÍ sigue siendo Materia Prima: eso se convierte en leche y carne', () => {
    const r = runLayer4(
      'FACTURA_COMPRA',
      factura('Nutrición Animal SRL', '12 toneladas de alimento balanceado y forraje para el tambo'),
      'AGRO',
    );

    expect(r.costSection).toBe('MATERIA_PRIMA');
    expect(r.requiresAI).toBe(false);
  });

  it('y los insumos del cultivo tampoco se tocaron', () => {
    const r = runLayer4(
      'FACTURA_COMPRA',
      factura('Agroinsumos del Centro', 'Semilla de soja, fertilizante y herbicida'),
      'AGRO',
    );

    expect(r.costSection).toBe('MATERIA_PRIMA');
    expect(r.requiresAI).toBe(false);
  });
});
