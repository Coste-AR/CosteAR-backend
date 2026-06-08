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

export const createCompanySchema = z.object({
  name: z.string().min(2, 'Nombre demasiado corto').max(160).trim(),
  industry: z.string().max(120).trim().optional(),
  cuit: cuitSchema.optional(),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = createCompanySchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export { isValidCuit };
