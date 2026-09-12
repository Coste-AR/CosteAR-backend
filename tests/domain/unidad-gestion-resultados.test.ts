import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  crearConversorUnidadGestion,
  type UnidadGestion,
} from '@/domain/units/unidad-gestion.js';

const UNIDAD: UnidadGestion = {
  codigo: 'bulto',
  nombre: 'Bulto de prueba',
  factor: 12,
};

describe('unidad de gestión en resultados', () => {
  it('convierte importes unitarios y cantidades base en sentidos opuestos', () => {
    const conversor = crearConversorUnidadGestion(UNIDAD);

    expect(conversor.importeUnitarioDesdeBase(5)).toBe(60);
    expect(conversor.cantidadDesdeBase(24)).toBe(2);
    expect(conversor.unidadGestion).toEqual(UNIDAD);
  });

  it('sin unidad declarada conserva el valor base y declara null', () => {
    const conversor = crearConversorUnidadGestion(null);

    expect(conversor.importeUnitarioDesdeBase(5)).toBe(5);
    expect(conversor.cantidadDesdeBase(24)).toBe(24);
    expect(conversor.unidadGestion).toBeNull();
  });

  it('los servicios delegan la aritmética al conversor de dominio', () => {
    const services = [
      'src/application/cost-structures/calculation-result-enrichment.ts',
      'src/application/cost-structures/period-comparison.ts',
      'src/application/cost-structures/owner-dashboard-service.ts',
    ];

    for (const path of services) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain('crearConversorUnidadGestion');
      expect(source).not.toMatch(/[*/]\s*(?:unidadGestion\.)?factor\b/);
    }
  });
});
