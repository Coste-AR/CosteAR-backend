import { z } from 'zod';

export const updateTargetBudgetSchema = z.object({
  rawMaterialsPct: z.number().min(0).max(100),
  laborPct: z.number().min(0).max(100),
  cifPct: z.number().min(0).max(100),
  marginPct: z.number().min(0).max(100),
}).refine(data => {
  // Suma con tolerancia a decimales de JS (e.g., 99.99999999999999 === 100)
  const sum = data.rawMaterialsPct + data.laborPct + data.cifPct + data.marginPct;
  return Math.abs(sum - 100) < 0.01;
}, {
  message: "La suma de los porcentajes debe ser exactamente 100",
});

export type UpdateTargetBudgetInput = z.infer<typeof updateTargetBudgetSchema>;
