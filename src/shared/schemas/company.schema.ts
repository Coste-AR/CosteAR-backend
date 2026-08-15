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

/**
 * La CONDICIÓN FRENTE AL IVA de la empresa. No es un dato administrativo: decide
 * qué importe de cada comprobante entra al costo.
 *
 * Cátedra, Clase 4 ("Materia prima — costo de adquisición, desperdicio y lote
 * económico"), línea 27: "IVA: solo aplica si la empresa es responsable no
 * inscripta o monotributista; si es responsable inscripta, el IVA no forma
 * parte del costo de adquisición".
 *
 * Responsable Inscripto → el IVA es crédito fiscal, se costea sobre el NETO.
 * Monotributo / Exento  → el IVA no se recupera, es costo: se costea sobre el TOTAL.
 */
export const condicionIvaSchema = z.enum(['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO']);
export type CondicionIvaInput = z.infer<typeof condicionIvaSchema>;

export const PREDEFINED_INDUSTRIES = [
  'Gastronomía',
  'Comercio Minorista (Retail)',
  'Fábrica / Manufactura',
  'Construcción',
  'Servicios Profesionales',
  'Logística y Transporte',
  'Agropecuario',
  'Otro'
];

export const createCompanySchema = z.object({
  name: z.string().min(2, 'Nombre demasiado corto').max(160).trim(),
  industry: z.string().max(120).trim().optional(),
  cuit: cuitSchema.optional(),
  description: z.string().max(5000).trim().optional(),
  periodicity: periodicitySchema.optional(),
  // Opcional en el contrato: omitirla deja el default de la DB
  // (RESPONSABLE_INSCRIPTO), que es lo que asume el resto del sistema.
  condicionIva: condicionIvaSchema.optional(),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = createCompanySchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export { isValidCuit };
