import { z } from 'zod';

export const acceptTermsSchema = z.object({
  termsVersionId: z.string().uuid(),
});
export type AcceptTermsInput = z.infer<typeof acceptTermsSchema>;

export const publishTermsSchema = z.object({
  content: z.string().min(50, 'El contenido es demasiado corto para ser un texto legal real').max(200_000),
});
export type PublishTermsInput = z.infer<typeof publishTermsSchema>;
