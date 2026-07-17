import { z } from 'zod';

/** Validación de CUIT argentino: 11 dígitos con dígito verificador. */
function isValidCuit(cuit: string): boolean {
  const clean = cuit.replace(/[-\s]/g, '');
  if (!/^\d{11}$/.test(clean)) return false;
  const digits = clean.split('').map(Number);
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * digits[i]!, 0);
  const mod = 11 - (sum % 11);
  const checkDigit = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return checkDigit === digits[10];
}

export const cuitSchema = z
  .string()
  .trim()
  .refine(isValidCuit, 'CUIT inválido (dígito verificador incorrecto)');

/**
 * El RITMO de costeo de la empresa: cada cuánto cierra un período.
 * No todas las empresas costean por mes: hay quienes cierran por quincena y quienes
 * lo hacen por trimestre. El calendario de períodos (`domain/periods/period-calendar.ts`)
 * ya sabía manejar los tres, pero hasta ahora no había forma de elegirlo: toda empresa
 * quedaba clavada en MONTHLY (el default de la DB) sin que nadie se enterara.
 */
export const periodicitySchema = z.enum(['MONTHLY', 'BIWEEKLY', 'QUARTERLY']);

export const createCompanySchema = z.object({
  name: z.string().min(2, 'Nombre demasiado corto').max(160).trim(),
  industry: z.string().max(120).trim().optional(),
  cuit: cuitSchema.optional(),
  description: z.string().max(5000).trim().optional(),
  periodicity: periodicitySchema.optional(),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = createCompanySchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export { isValidCuit };
