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

export const registerSchema = z.object({
  email: z.string().email('Email inválido').toLowerCase().trim(),
  password: passwordSchema,
  name: z.string().min(2, 'Nombre demasiado corto').max(120).trim(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
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
