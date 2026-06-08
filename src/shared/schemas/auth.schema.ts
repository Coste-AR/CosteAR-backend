import { z } from 'zod';

/**
 * Schemas de validación de autenticación. Compartidos como contrato entre la
 * capa HTTP (validación de entrada) y los use cases. El frontend usa los
 * mismos schemas (copiados al repo de front) para validar antes de enviar.
 */

// Política de contraseña: mínimo 10 chars, mezcla de tipos. La fortaleza fina
// (zxcvbn) se evalúa en el use case; aquí va el piso estructural.
export const passwordSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(128, 'La contraseña es demasiado larga')
  .regex(/[a-z]/, 'Debe incluir al menos una minúscula')
  .regex(/[A-Z]/, 'Debe incluir al menos una mayúscula')
  .regex(/[0-9]/, 'Debe incluir al menos un número');

/** Validación de CUIT/CUIL argentino (11 dígitos + dígito verificador). */
function isValidCuitCuil(value: string): boolean {
  const clean = value.replace(/[-\s]/g, '');
  if (!/^\d{11}$/.test(clean)) return false;
  const digits = clean.split('').map(Number);
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * digits[i]!, 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return check === digits[10];
}

export const professionalTypeSchema = z.enum([
  'CONTADOR_PUBLICO',
  'LIC_ADMINISTRACION',
  'CONSULTOR_INDEPENDIENTE',
  'ANALISTA_INTERNO',
  'OTRO',
]);

/** Cliente inicial opcional, cargado durante el onboarding. */
export const initialClientSchema = z.object({
  name: z.string().min(2, 'Nombre demasiado corto').max(160).trim(),
  industry: z.string().max(120).trim().optional(),
  cuit: z
    .string()
    .trim()
    .refine(isValidCuitCuil, 'CUIT del cliente inválido')
    .optional(),
});

export const registerSchema = z.object({
  // Paso 1 — Cuenta
  email: z.string().email('Email inválido').toLowerCase().trim(),
  password: passwordSchema,
  name: z.string().min(2, 'Nombre demasiado corto').max(120).trim(),

  // Paso 2 — Datos profesionales
  cuit: z.string().trim().refine(isValidCuitCuil, 'CUIT/CUIL inválido'),
  dni: z
    .string()
    .trim()
    .regex(/^\d{7,8}$/, 'DNI inválido (7 u 8 dígitos)')
    .optional(),
  professionalType: professionalTypeSchema,
  licenseNumber: z.string().max(60).trim().optional(),
  province: z.string().min(2).max(80).trim().default('Tucumán'),

  // Paso 3 — Cartera inicial (opcional)
  initialClients: z.array(initialClientSchema).max(20).optional(),

  // Paso 4 — Preferencias
  marginThresholdPct: z.number().finite().min(0).max(100).default(15),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export { isValidCuitCuil };

export const loginSchema = z.object({
  // CUIT/CUIL es el identificador principal de sesión (11 dígitos, con o sin guiones).
  cuit: z
    .string()
    .trim()
    .refine(
      (v) => {
        const clean = v.replace(/[-\s]/g, '');
        return /^\d{11}$/.test(clean);
      },
      'CUIT/CUIL inválido — debe tener 11 dígitos',
    ),
  password: z.string().min(1, 'La contraseña es requerida'),
  // Código TOTP opcional: se exige en un segundo paso si el usuario tiene 2FA.
  twoFactorCode: z.string().regex(/^\d{6}$/).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyTwoFactorSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'El código debe tener 6 dígitos'),
});
export type VerifyTwoFactorInput = z.infer<typeof verifyTwoFactorSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
