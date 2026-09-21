import { z } from 'zod';

const accesosRapidosSchema = z.array(z.string().min(1)).max(6).refine(
  (claves) => new Set(claves).size === claves.length,
  { message: 'Los accesos rápidos no pueden repetirse' },
);

export const userPreferencesSchema = z.object({
  home: z.object({ accesosRapidos: accesosRapidosSchema }),
}).strict();

export const userPreferencesEnvelopeSchema = z.object({ data: userPreferencesSchema });

export const widgetCatalogItemSchema = z.object({
  clave: z.string(),
  etiqueta: z.string(),
  modulo: z.string(),
  porDefecto: z.boolean(),
});

export const widgetCatalogEnvelopeSchema = z.object({ data: z.array(widgetCatalogItemSchema) });

export type UserPreferences = z.infer<typeof userPreferencesSchema>;
