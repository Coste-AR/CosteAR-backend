import { describe, it, expect } from 'vitest';
import { isValidCuit, createCompanySchema } from '@/shared/schemas/company.schema.js';

describe('Validación de CUIT', () => {
  it('acepta un CUIT con dígito verificador correcto', () => {
    // 20-12345678-6: dígito verificador calculado a mano = 6
    expect(isValidCuit('20123456786')).toBe(true);
    expect(isValidCuit('20-12345678-6')).toBe(true);
  });

  it('rechaza un CUIT con dígito verificador incorrecto', () => {
    expect(isValidCuit('20123456780')).toBe(false);
  });

  it('rechaza longitudes inválidas', () => {
    expect(isValidCuit('123')).toBe(false);
    expect(isValidCuit('201234567861')).toBe(false);
  });
});

describe('createCompanySchema', () => {
  it('valida una empresa correcta', () => {
    const r = createCompanySchema.safeParse({
      name: 'Metalúrgica del Norte',
      industry: 'Manufactura',
      cuit: '20-12345678-6',
    });
    expect(r.success).toBe(true);
  });

  it('acepta empresa sin CUIT ni industria (opcionales)', () => {
    const r = createCompanySchema.safeParse({ name: 'PyME X' });
    expect(r.success).toBe(true);
  });

  it('rechaza nombre demasiado corto', () => {
    const r = createCompanySchema.safeParse({ name: 'X' });
    expect(r.success).toBe(false);
  });

  it('rechaza CUIT inválido', () => {
    const r = createCompanySchema.safeParse({ name: 'PyME', cuit: '20123456780' });
    expect(r.success).toBe(false);
  });
});
