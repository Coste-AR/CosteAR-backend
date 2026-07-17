/**
 * Servicio de análisis de documentos con Groq.
 *
 * Analiza documentos enviados por operadores y devuelve:
 *  - Tipo de documento detectado
 *  - Calidad (legible / parcial / ilegible)
 *  - Datos extraídos estructurados (para pre-llenar el sistema)
 *  - Mensaje humano con observaciones
 *  - A qué sección de costos aplica
 */

import { getEnv } from '../config/env.js';
import { groqFetch } from './groq-rate-limiter.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const TEXT_MODEL   = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = `Sos un asistente experto en contabilidad de costos para PyMEs argentinas.
Los operadores de empresas te envían documentos (facturas, liquidaciones, planillas, o texto libre)
para que los analices y extraigas información para el sistema de costeo.

El sistema maneja estas áreas de COSTO de producción (inventariable, parte del costo unitario):
- MATERIA_PRIMA: compras de insumos, materiales, facturas de proveedores, Wilson, ficha PPP
- MANO_DE_OBRA: liquidaciones de sueldos, horas, departamentos, ITCS, cargas sociales
- COSTOS_INDIRECTOS: alquileres, energía, seguros, mantenimiento, CIF, prorrateo, capacidad normal / actividad real / CIP real por centro productivo
- VENTAS: precio de venta unitario, cantidad producida/vendida

Y estas áreas de GASTO (NO son costo del producto, NO van en COSTOS_INDIRECTOS):
- GASTO_COMERCIALIZACION: gasto de cara a la venta/marketing (publicidad, comisiones de vendedores, viáticos de vendedores, promoción, folletería).
- GASTO_ADMINISTRACION: gasto de back-office/conducción (honorarios del contador/estudio, sueldos de administración/gerencia, papelería y útiles de oficina).
- GASTO_FINANCIERO: costo de financiamiento/servicios bancarios (comisiones bancarias, intereses financieros, gastos de mantenimiento de cuenta, impuesto al cheque).
REGLA: los gastos de comercialización, administración y financieros NO son inventariables — nunca los pongas en COSTOS_INDIRECTOS, porque inflarían la tasa de prorrateo y el costo unitario.

IMPORTANTE: Un mismo mensaje puede contener datos de VARIAS secciones a la vez.
Cuando eso ocurra, extraé TODOS los datos de TODAS las secciones presentes.

Respondé SIEMPRE con un JSON válido (sin texto fuera del JSON):
{
  "documentType": "factura_compra | factura_venta | liquidacion_sueldos | planilla_horas | datos_costeo | otro",
  "quality": "legible | parcial | ilegible",
  "qualityNote": "string o null",
  "costSection": "MATERIA_PRIMA | MANO_DE_OBRA | COSTOS_INDIRECTOS | VENTAS | GASTO_COMERCIALIZACION | GASTO_ADMINISTRACION | GASTO_FINANCIERO | MULTIPLE | DESCONOCIDO",
  "message": "2 a 4 oraciones en español argentino para el operador",
  "extractedData": {
    "date": "YYYY-MM-DD o null",
    "supplier": "string o null",
    "invoiceNumber": "string o null",
    "totalAmount": número o null,
    "netAmount": número o null,
    "currency": "ARS | USD | null",
    "items": [{ "description": "string", "quantity": número o null, "unitCost": número o null, "total": número o null }],
    "department": "string o null",
    "hoursWorked": número o null,
    "employeeCount": número o null
  },
  "sections": {
    "rawMaterial": {
      "present": true,
      "wilson": { "annualDemand": número o null, "orderCost": número o null, "holdingRate": número o null, "unitCost": número o null },
      "stockPolicy": { "minConsumption": número o null, "maxConsumption": número o null, "minLeadTime": número o null, "maxLeadTime": número o null, "safetyStock": número o null },
      "initialStock": { "quantity": número o null, "unitCost": número o null },
      "movements": [{ "date": "YYYY-MM-DD", "type": "purchase | consumption", "detail": "string", "quantity": número, "unitCost": número }]
    },
    "directLabor": {
      "present": true,
      "workingDays": { "totalDaysPerYear": número o null, "sundays": número o null, "saturdays": número o null, "holidays": número o null, "vacations": número o null, "sickness": número o null, "specialLeaves": número o null, "workAccidents": número o null, "unjustifiedAbsences": número o null, "holidaysOnWeekend": número o null },
      "itcs": { "derivationBase": número o null, "fixedArt": número o null, "uncertainCharges": [{ "name": "string", "coefficient": número }] },
      "departments": [{ "name": "string", "basicRemuneration": número, "hoursWorked": número }]
    },
    "indirectCosts": {
      "present": true,
      "centers": [{ "id": "string", "name": "string", "type": "productive | service" }],
      "concepts": [{ "name": "string", "amountFixed": número, "amountVariable": número }],
      "productiveSettings": [{ "center": "nombre o id del centro productivo", "normalCapacity": número o null, "actualActivity": número o null, "actualCip": número o null }]
    },
    "sales": {
      "present": true,
      "unitPrice": número o null,
      "quantity": número o null
    }
  }
}

CARGAS SOCIALES INCIERTAS (itcs.uncertainCharges) — MUY IMPORTANTE:
Listá TODAS las cargas sociales inciertas que aparezcan en el documento, con su nombre TAL CUAL figura
y su coeficiente (ej: premio por asistencia perfecta, premio por productividad, antigüedad, horas extras,
comisiones, uniformes/ropa de trabajo, viandas/almuerzos, guardería, medicamentos, útiles escolares,
viáticos, asignaciones familiares…).
NO las clasifiques en remunerativas / no remunerativas, y NO inventes esa distinción: el sistema clasifica
cada concepto con su propio catálogo. Vos solo extraés nombre y coeficiente.
NO incluyas el ausentismo pago (IAP/YAP): lo calcula el sistema a partir de los días.

Si una sección NO está presente en el documento, ponés "present": false y omitís los demás campos de esa sección.
Si el documento está ilegible, todos los "present" van en false.
Nunca rompas el formato JSON.`;

export interface RawMaterialSectionData {
  present: boolean;
  wilson?: { annualDemand?: number | null; orderCost?: number | null; holdingRate?: number | null; unitCost?: number | null };
  stockPolicy?: { minConsumption?: number | null; maxConsumption?: number | null; minLeadTime?: number | null; maxLeadTime?: number | null; safetyStock?: number | null };
  initialStock?: { quantity?: number | null; unitCost?: number | null };
  movements?: { date: string; type: 'purchase' | 'consumption'; detail: string; quantity: number; unitCost: number }[];
}

export interface DirectLaborSectionData {
  present: boolean;
  workingDays?: {
    totalDaysPerYear?: number | null; sundays?: number | null; saturdays?: number | null;
    holidays?: number | null; vacations?: number | null; sickness?: number | null;
    specialLeaves?: number | null; workAccidents?: number | null;
    unjustifiedAbsences?: number | null; holidaysOnWeekend?: number | null;
  };
  itcs?: {
    derivationBase?: number | null;
    fixedArt?: number | null;
    /** D-2: cargas inciertas SIN clasificar. La IA solo extrae nombre y coeficiente;
     *  el sistema decide si son remunerativas o no con el catálogo de la cátedra. */
    uncertainCharges?: { name: string; coefficient: number }[];
    /** Formato viejo (documentos analizados antes de D-2). Se sigue leyendo, pero
     *  la clasificación que traiga NO se toma como verdad: la revisa el catálogo. */
    uncertainRemunerative?: { name: string; coefficient: number }[];
    uncertainNonRemunerative?: { name: string; coefficient: number }[];
  };
  departments?: { name: string; basicRemuneration: number; hoursWorked: number }[];
}

export interface IndirectCostsSectionData {
  present: boolean;
  centers?: { id: string; name: string; type: 'productive' | 'service' }[];
  // La DISTRIBUCIÓN (prorrateo) NO se extrae de la IA (E1): la pone el costista a
  // mano o la deriva una base de asignación. La IA solo trae nombre e importes.
  concepts?: { name: string; amountFixed: number; amountVariable: number }[];
  /** Datos de fin de mes por centro productivo (capacidad normal, actividad real, CIP real).
   *  El presupuesto NO se incluye: se deriva del prorrateo al guardar. */
  productiveSettings?: {
    center: string;
    normalCapacity?: number | null;
    actualActivity?: number | null;
    actualCip?: number | null;
  }[];
}

export interface SalesSectionData {
  present: boolean;
  unitPrice?: number | null;
  quantity?: number | null;
}

export interface DocumentAnalysis {
  documentType: string;
  quality: 'legible' | 'parcial' | 'ilegible';
  qualityNote?: string;
  costSection: 'MATERIA_PRIMA' | 'MANO_DE_OBRA' | 'COSTOS_INDIRECTOS' | 'VENTAS' | 'GASTO_COMERCIALIZACION' | 'GASTO_ADMINISTRACION' | 'GASTO_FINANCIERO' | 'MULTIPLE' | 'DESCONOCIDO';
  message: string;
  extractedData: {
    date?: string | null;
    supplier?: string | null;
    invoiceNumber?: string | null;
    totalAmount?: number | null;
    taxAmount?: number | null;
    netAmount?: number | null;
    currency?: string | null;
    items?: { description: string; quantity?: number | null; unitCost?: number | null; total?: number | null }[];
    department?: string | null;
    hoursWorked?: number | null;
    employeeCount?: number | null;
  };
  sections?: {
    rawMaterial?: RawMaterialSectionData;
    directLabor?: DirectLaborSectionData;
    indirectCosts?: IndirectCostsSectionData;
    sales?: SalesSectionData;
  };
}

interface GroqResponse {
  choices: { message: { content: string } }[];
}

export class GroqService {
  private readonly apiKey: string;

  constructor() {
    this.apiKey = getEnv().GROQ_API_KEY;
  }

  get isConfigured(): boolean {
    // El default de env es 'groq_placeholder' (16 chars): pasaba length>10 y
    // disparaba llamadas reales que fallan con "Invalid API Key". Lo excluimos
    // explícitamente para que sin key válida la IA se saltee limpio (fallback a
    // reglas deterministas / revisión humana) en vez de fallar por cada request.
    return this.apiKey.length > 10 && this.apiKey !== 'groq_placeholder';
  }

  /**
   * Completion genérica que devuelve JSON parseado. Usada por el consejero.
   * Devuelve null si la API no está configurada o falla (no-fatal).
   */
  async completeJSON<T>(systemPrompt: string, userPrompt: string): Promise<T | null> {
    if (!this.isConfigured) return null;
    try {
      const res = await groqFetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: TEXT_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 500,
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) { console.error('[groq] completeJSON error:', await res.text()); return null; }
      const data = await res.json() as GroqResponse;
      const raw = data.choices[0]?.message.content ?? '';
      return JSON.parse(raw) as T;
    } catch (err) {
      console.error('[groq] completeJSON unexpected error:', err);
      return null;
    }
  }

  async analyzeDocument(input: {
    text?: string;
    fileData?: string;
    fileMimeType?: string;
    fileName?: string;
    companyContext?: string | null;
  }): Promise<DocumentAnalysis | null> {
    if (!this.isConfigured) return null;

    const isImage = input.fileMimeType?.startsWith('image/') ?? false;
    const isPdf   = input.fileMimeType === 'application/pdf';

    let sysPrompt = SYSTEM_PROMPT;
    if (input.companyContext) {
      sysPrompt += `\n\nCONTEXTO DE ESTA EMPRESA CLIENTE (Uso del costeo, rubro y forma de operar):\n${input.companyContext}\nConsiderá este contexto al clasificar y extraer datos del documento.`;
    }

    try {
      let messages: object[];

      if (isImage && input.fileData) {
        messages = [
          { role: 'system', content: sysPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${input.fileMimeType};base64,${input.fileData}` },
              },
              {
                type: 'text',
                text: input.text
                  ? `El operador agregó este comentario junto con la imagen: "${input.text}"`
                  : 'Analizá este documento y devolvé el JSON.',
              },
            ],
          },
        ];
      } else {
        const content = [
          isPdf && input.fileName ? `Archivo PDF adjunto: ${input.fileName}` : '',
          input.text ? `Contenido / descripción del operador:\n${input.text}` : '',
        ].filter(Boolean).join('\n\n');

        messages = [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: content || 'Mensaje vacío — indicalo en el JSON.' },
        ];
      }

      const model = isImage ? VISION_MODEL : TEXT_MODEL;

      const res = await groqFetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 2500,
          temperature: 0.1, // Baja temperatura para JSON consistente
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        console.error('[groq] Error de API:', await res.text());
        return null;
      }

      const data = await res.json() as GroqResponse;
      const raw = data.choices[0]?.message.content ?? '';

      try {
        return JSON.parse(raw) as DocumentAnalysis;
      } catch {
        console.error('[groq] JSON inválido:', raw);
        return null;
      }
    } catch (err) {
      console.error('[groq] Error inesperado:', err);
      return null;
    }
  }

  /**
   * Layer 5 AI Fallback: classifies a document when deterministic rules
   * couldn't reach the confidence threshold.
   */
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
  }): Promise<{ documentType: string; costSection: string; confidence: number; reasoning: string } | null> {
    if (!this.isConfigured) return null;

    const signalsSummary = input.foundSignalLabels.length > 0
      ? input.foundSignalLabels.map((l) => `- ${l}`).join('\n')
      : '- Ninguna señal encontrada';

    const industryCtx = input.industryLabel
      ? `Rubro de la empresa: ${input.industryLabel} (categoría interna: ${input.industryCategory ?? 'DEFAULT'}).`
      : 'Rubro de la empresa: no especificado.';

    const intentCtx = input.intent && input.intent !== 'DOCUMENTO_FORMAL'
      ? `Nota: el mensaje fue detectado como "${input.intent}", tener en cuenta al clasificar.`
      : '';

    // Desempate explícito cuando las reglas dejaron dos candidatos peleados.
    const ambiguityCtx = input.ambiguityHint
      ? `\n⚠️ CASO AMBIGUO: ${input.ambiguityHint}`
      : '';

    // Memoria: ejemplos reales de cómo el costista corrigió casos parecidos.
    const examplesCtx = input.correctionExamples
      ? `\nEjemplos de clasificaciones que este costista validó/corrigió en casos similares (seguí su criterio):\n${input.correctionExamples}`
      : '';

    // Instrucciones específicas por rubro para evitar errores sistemáticos
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

    try {
      const res = await groqFetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: TEXT_MODEL,
          messages: [
            { role: 'system', content: 'Sos un clasificador de documentos contables argentinos. Respondé solo con JSON válido.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 200,
          temperature: 0.05,
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        console.error('[groq] classifyDocument error:', await res.text());
        return null;
      }

      const data = await res.json() as GroqResponse;
      const raw = data.choices[0]?.message.content ?? '';
      return JSON.parse(raw) as { documentType: string; costSection: string; confidence: number; reasoning: string };
    } catch (err) {
      console.error('[groq] classifyDocument unexpected error:', err);
      return null;
    }
  }
}
