import { GroqClient, tryParseJson, buildRetryHint, TEXT_MODEL, DETERMINISTIC_SAMPLING } from './groq-client.js';
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

    // ⚠️ NO ESCRIBAS ACÁ UNA REGLA SOBRE EL FLETE.
    // El hint de AGRO decía "flete de granos es COSTOS_INDIRECTOS" y era una
    // instrucción EQUIVOCADA que la IA obedecía: contradice el costo de
    // adquisición de la cátedra (Clase 4, ll. 15-18) y fue la causa agravante
    // medida del error FLE-02 (flete sobre una compra de maíz → CIP, conf 97).
    // El flete depende de SU DESTINO, no del rubro, así que la regla vive una
    // sola vez en REGLA_COSTO_ADQUISICION (abajo) y aplica a todos los rubros.
    const industryHints: Record<string, string> = {
      // El hint de AGRO decía que "combustible (gasoil) es MATERIA_PRIMA". Era la
      // misma regla equivocada que el perfil AGRO tenía en `fuelIsMP: true` y que
      // CL-04 ya había corregido para avicultura: el gasoil mueve el tractor, no
      // se convierte en grano ni en leche. Dejarlo acá habría hecho que la IA
      // contradijera al ruteo determinista sobre el mismo comprobante.
      AGRO:        'En agroindustria: semillas, agroquímicos y fertilizantes son MATERIA_PRIMA; en ganadería y tambo el alimento (forraje, balanceado) también. El combustible (gasoil de tractores y maquinaria) es fuerza motriz → COSTOS_INDIRECTOS, y la sanidad del rodeo (vacunas, veterinario) es material indirecto → COSTOS_INDIRECTOS.',
      GASTRONOMIA: 'En gastronomía: ingredientes (carne, verdura, lácteos, bebidas) y gas de cocina son MATERIA_PRIMA. Alquiler del local, luz, agua son COSTOS_INDIRECTOS.',
      MANUFACTURA: 'En manufactura: materias primas del proceso productivo son MATERIA_PRIMA. Energía eléctrica suele ser COSTOS_INDIRECTOS salvo que sea insumo directo del proceso.',
      CONSTRUCCION:'En construcción: materiales (cemento, hierro, madera) son MATERIA_PRIMA. Alquiler de equipos y movimientos internos de obra son COSTOS_INDIRECTOS.',
      TEXTIL:      'En textil: telas, hilos, botones, cierres son MATERIA_PRIMA. Electricidad del taller es COSTOS_INDIRECTOS.',
      SALUD:       'En salud: medicamentos, insumos médicos, reactivos son MATERIA_PRIMA. Equipos y habilitaciones son COSTOS_INDIRECTOS.',
      TRANSPORTE:  'En transporte: combustible, neumáticos, repuestos son MATERIA_PRIMA (insumos directos del servicio). Seguro y peaje son COSTOS_INDIRECTOS. La energía eléctrica y el gas del depósito, la cochera o la oficina NO son combustible del viaje → COSTOS_INDIRECTOS.',
      COMERCIO:    'En comercio: mercadería para reventa es MATERIA_PRIMA (costo del producto). La logística interna del depósito y el alquiler son COSTOS_INDIRECTOS.',
      SERVICIOS:   'En servicios profesionales: casi no hay MATERIA_PRIMA. Honorarios de personal son MANO_DE_OBRA. Oficina, internet, software son COSTOS_INDIRECTOS.',
    };
    const industryHint = input.industryCategory ? (industryHints[input.industryCategory] ?? '') : '';

    /**
     * Costo de adquisición — Clase 4, ll. 15-18: "Costo de nacionalización +
     * flete carretero hasta destino (ej. Tucumán) = costo de adquisición total".
     *
     * Es TRANSVERSAL a todos los rubros y por eso vive acá y no en los hints de
     * rubro: la misma palabra "flete" tiene dos destinos contables según sobre
     * qué viaje, no según la industria. Reemplaza —y contradice a propósito— la
     * frase "flete de granos es COSTOS_INDIRECTOS" que tenía el hint de AGRO.
     * Es la misma regla que ya declara groq-document-analyzer.ts (regla 1).
     */
    const REGLA_COSTO_ADQUISICION =
      'COSTO DE ADQUISICIÓN (aplica a cualquier rubro): el flete, el seguro y el acarreo ' +
      'SOBRE UNA COMPRA integran el costo de adquisición de lo comprado y se imputan a la ' +
      'misma sección que esa compra. Da igual que vengan facturados aparte por el ' +
      'transportista: si el comprobante dice que el flete es por la compra de una materia ' +
      'prima —aunque solo lo declare citando el número de la factura de esa compra— va a ' +
      'MATERIA_PRIMA, no a COSTOS_INDIRECTOS. Solo el flete SIN compra asociada (movimiento ' +
      'interno de planta, logística entre depósitos, reparto propio) es COSTOS_INDIRECTOS.';

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

${REGLA_COSTO_ADQUISICION}

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
      // ⚠️ NO SUBAS ESTA TEMPERATURA NI SAQUES EL SEED.
      // Con `temperature: 0.05` y sin seed, dos corridas del mismo corpus sin un
      // solo cambio de código dieron 61,1% y 66,7% de accuracy: ninguna medición
      // de mejora del clasificador era confiable, porque la diferencia entre dos
      // versiones quedaba tapada por el ruido del muestreo. Y para el cliente, el
      // mismo comprobante tenía que dar SIEMPRE el mismo resultado — un costista
      // no puede defender ante su cliente una imputación que cambia sola.
      ...DETERMINISTIC_SAMPLING,
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
