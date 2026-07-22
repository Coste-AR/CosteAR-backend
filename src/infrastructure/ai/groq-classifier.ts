import { GroqClient, tryParseJson, buildRetryHint, TEXT_MODEL } from './groq-client.js';
import {
  classifyResponseSchema,
  salvageClassifyResponse,
  fallbackClassifyResponse,
} from './groq-schemas.js';
import type { ClassifyResponse } from './groq-types.js';

export class GroqClassifier {
  constructor(private client: GroqClient = new GroqClient()) {}

  async classifyDocument(input: {
    text: string;
    accumulatedPts: number;
    foundSignalLabels: string[];
    suggestedType: string | null;
    industryLabel?: string;
    industryCategory?: string;
    intent?: string;
    ambiguityHint?: string;
    correctionExamples?: string;
  }): Promise<ClassifyResponse | null> {
    if (!this.client.isConfigured) return null;

    const signalsSummary = input.foundSignalLabels.length > 0
      ? input.foundSignalLabels.map((l) => `- ${l}`).join('\n')
      : '- Ninguna señal encontrada';

    const industryCtx = input.industryLabel
      ? `Rubro de la empresa: ${input.industryLabel} (categoría interna: ${input.industryCategory ?? 'DEFAULT'}).`
      : 'Rubro de la empresa: no especificado.';

    const intentCtx = input.intent && input.intent !== 'DOCUMENTO_FORMAL'
      ? `Nota: el mensaje fue detectado como "${input.intent}", tener en cuenta al clasificar.`
      : '';

    const ambiguityCtx = input.ambiguityHint
      ? `\n⚠️ CASO AMBIGUO: ${input.ambiguityHint}`
      : '';

    const examplesCtx = input.correctionExamples
      ? `\nEjemplos de clasificaciones que este costista validó/corrigió en casos similares (seguí su criterio):\n${input.correctionExamples}`
      : '';

    const industryHints: Record<string, string> = {
      AGRO:        'En agroindustria: combustible (gasoil) es MATERIA_PRIMA (insumo de tractores/maquinaria), semillas/agroquímicos son MATERIA_PRIMA, flete de granos es COSTOS_INDIRECTOS.',
      GASTRONOMIA: 'En gastronomía: ingredientes (carne, verdura, lácteos, bebidas) y gas de cocina son MATERIA_PRIMA. Alquiler del local, luz, agua son COSTOS_INDIRECTOS.',
      MANUFACTURA: 'En manufactura: materias primas del proceso productivo son MATERIA_PRIMA. Energía eléctrica suele ser COSTOS_INDIRECTOS salvo que sea insumo directo del proceso.',
      CONSTRUCCION:'En construcción: materiales (cemento, hierro, madera) son MATERIA_PRIMA. Alquiler de equipos y transporte son COSTOS_INDIRECTOS.',
      TEXTIL:      'En textil: telas, hilos, botones, cierres son MATERIA_PRIMA. Electricidad del taller es COSTOS_INDIRECTOS.',
      SALUD:       'En salud: medicamentos, insumos médicos, reactivos son MATERIA_PRIMA. Equipos y habilitaciones son COSTOS_INDIRECTOS.',
      TRANSPORTE:  'En transporte: combustible, neumáticos, repuestos son MATERIA_PRIMA (insumos directos del servicio). Seguro y peaje son COSTOS_INDIRECTOS.',
      COMERCIO:    'En comercio: mercadería para reventa es MATERIA_PRIMA (costo del producto). Logística y alquiler son COSTOS_INDIRECTOS.',
      SERVICIOS:   'En servicios profesionales: casi no hay MATERIA_PRIMA. Honorarios de personal son MANO_DE_OBRA. Oficina, internet, software son COSTOS_INDIRECTOS.',
    };
    const industryHint = input.industryCategory ? (industryHints[input.industryCategory] ?? '') : '';

    const prompt = `Contexto: documento contable argentino enviado por un operador de PyME.
${industryCtx}
${industryHint}
${intentCtx}${ambiguityCtx}${examplesCtx}

El clasificador de reglas encontró estas señales:
${signalsSummary}
Confianza acumulada: ${input.accumulatedPts}/100
Clasificación parcial: ${input.suggestedType ?? 'DESCONOCIDO'}

Texto del documento:
${input.text.slice(0, 3000)}

Tipos posibles: FACTURA_COMPRA, FACTURA_VENTA, REMITO, LIQUIDACION_MOD, PLANILLA_HORAS, NOTA_DEBITO, NOTA_CREDITO, DESCONOCIDO
Secciones: MATERIA_PRIMA, MANO_DE_OBRA, COSTOS_INDIRECTOS, VENTAS, GASTO_COMERCIALIZACION, GASTO_ADMINISTRACION, GASTO_FINANCIERO, MULTIPLE, DESCONOCIDO

COSTO vs GASTO: solo MP, MOD y CIP son costo del producto. Los gastos NO van a COSTOS_INDIRECTOS:
- GASTO_COMERCIALIZACION: gasto de venta/marketing (publicidad, comisiones y viáticos de vendedores, promoción).
- GASTO_ADMINISTRACION: gasto de back-office/conducción (honorarios contador/estudio, sueldos de administración/gerencia, papelería de oficina).
- GASTO_FINANCIERO: costo de financiamiento/banca (comisiones bancarias, intereses financieros, mantenimiento de cuenta, impuesto al cheque).

Respondé SOLO con JSON:
{
  "documentType": "...",
  "costSection": "...",
  "confidence": <número 0-100>,
  "reasoning": "una oración en español explicando la decisión, mencionando el rubro si influyó"
}`;

    const systemMsg = { role: 'system', content: 'Sos un clasificador de documentos contables argentinos. Respondé solo con JSON válido.' };
    const baseMessages = [systemMsg, { role: 'user', content: prompt }];
    const baseBody = {
      model: TEXT_MODEL,
      max_tokens: 200,
      temperature: 0.05,
      response_format: { type: 'json_object' as const },
    };

    try {
      let everGotContent = false;

      const raw1 = await this.client.postGroqRaw({ ...baseBody, messages: baseMessages });
      if (raw1 !== null) everGotContent = true;
      const parsed1 = tryParseJson(raw1);
      const val1 = parsed1 !== undefined ? classifyResponseSchema.safeParse(parsed1) : null;
      if (val1?.success) return val1.data as ClassifyResponse;

      const hint = buildRetryHint(raw1, parsed1, val1 && !val1.success ? val1.error : null);
      const retryMessages = [
        ...baseMessages,
        { role: 'assistant', content: raw1 ?? '' },
        {
          role: 'user',
          content:
            `Tu respuesta anterior no pasó la validación por lo siguiente:\n${hint}\n\n` +
            `Corregí ESOS campos y devolvé de nuevo SOLO el JSON válido, en el mismo formato.`,
        },
      ];

      const raw2 = await this.client.postGroqRaw({ ...baseBody, messages: retryMessages });
      if (raw2 !== null) everGotContent = true;
      const parsed2 = tryParseJson(raw2);
      const val2 = parsed2 !== undefined ? classifyResponseSchema.safeParse(parsed2) : null;
      if (val2?.success) return val2.data as ClassifyResponse;

      if (!everGotContent) return null;

      if (val2 && !val2.success) {
        const salvaged = salvageClassifyResponse(parsed2, val2.error.issues);
        if (salvaged) return salvaged;
      } else if (val1 && !val1.success) {
        const salvaged = salvageClassifyResponse(parsed1, val1.error.issues);
        if (salvaged) return salvaged;
      }

      console.error('[groq] classifyDocument: respuesta inválida tras reintento; usando fallback DESCONOCIDO.');
      return fallbackClassifyResponse();
    } catch (err) {
      console.error('[groq] classifyDocument unexpected error:', err);
      return null;
    }
  }
}
