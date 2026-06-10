# Clasificador de Documentos Contables — Diseño de Sistema en Cascada

> **Para workers agénticos:** usar superpowers:executing-plans para implementar.

**Goal:** Clasificar documentos enviados por operadores con >95% de confianza en el tipo de documento y >90% en la sección de costos, sin depender de valores numéricos que cambien con la economía argentina.

**Arquitectura:** Pipeline en 6 capas. Las capas 1–3 son deterministas (código puro). La capa 4 es el clasificador de negocio. La capa 5 es Groq AI (solo para ambiguos). La capa 6 es escalación humana. El sistema nunca fuerza una clasificación incorrecta — prefiere `REQUIERE_REVISION_MANUAL` a un falso positivo.

**Stack:** TypeScript (backend Node.js existente), Groq API (ya integrada), PostgreSQL/Prisma (ya existente).

---

## Contexto del problema

Los documentos contables argentinos tienen dos dimensiones de clasificación:

1. **Tipo de documento** (¿qué es?): FACTURA_COMPRA, FACTURA_VENTA, REMITO, LIQUIDACION_MOD, PLANILLA_HORAS, NOTA_DEBITO, OTRO
2. **Sección de costos** (¿a dónde va en el sistema?): MATERIA_PRIMA, MANO_DE_OBRA, COSTOS_INDIRECTOS, VENTAS

El tipo de documento tiene señales estructurales muy fuertes (CAE, encabezados legales AFIP/ARCA, formato CUIT) que permiten >97% de confianza con reglas deterministas. La sección de costos requiere comprensión semántica del contenido — ahí entra el AI.

**Restricción crítica:** Los valores económicos cambian constantemente (alícuotas de IVA, salarios mínimos, retenciones). El clasificador NUNCA usa valores numéricos específicos como señales. Solo usa estructura, formato y vocabulario legal fijo.

---

## Arquitectura del pipeline

```
Documento (texto + imagen/PDF)
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│  CAPA 0: Quality Gate                                             │
│  Si ilegible → REQUIERE_REVISION (no intenta clasificar)          │
│  Si parcial  → continúa pero confidenceCap = 65                   │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│  CAPA 1: Señales Definitivas (AFIP/ARCA hardcoded legal)          │
│  Si matchea → confianza 95–98, salta directo a Capa 4             │
│  CAE 14 dígitos             → FACTURA (conf: 97)                  │
│  "RECIBO DE SUELDO" exacto  → LIQUIDACION_MOD (conf: 98)          │
│  "LIQUIDACIÓN DE HABERES"   → LIQUIDACION_MOD (conf: 98)          │
│  "FACTURA [A-C]" + CUIT     → FACTURA (conf: 97)                  │
│  "NOTA DE DÉBITO [A-C]"     → NOTA_DEBITO (conf: 96)              │
│  Sin match definitivo → continúa a Capa 2                         │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│  CAPA 2: Señales Corroborantes (acumulación ponderada)            │
│  Cada señal suma puntos. Contradicciones restan.                  │
│  Umbral de corte: 72 pts → salta a Capa 4 (sin AI)               │
│  < 72 pts → continúa a Capa 3                                     │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│  CAPA 3: Validación Estructural Numérica                          │
│  Confirma o penaliza lo detectado en Capa 2.                      │
│  No clasifica solo, solo valida consistencia.                     │
│  Si pasa validación: +15 pts                                      │
│  Si falla: −20 pts (señal contradictoria = baja confianza)        │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│  CAPA 4: Business Routing (sección de costos)                     │
│  Una vez clasificado el tipo → determinar sección                 │
│  Reglas deterministas primero, AI si ambiguo                      │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│  CAPA 5: Groq AI Fallback                                         │
│  Solo se invoca si confianza total < 72                           │
│  Recibe: texto + señales encontradas + clasificación parcial      │
│  Devuelve: tipo + sección + confianza + razonamiento              │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│  CAPA 6: Escalación                                               │
│  Si confianza final < 72 (incluso post-AI) → REQUIERE_REVISION    │
│  El costista ve las señales encontradas + la clasificación tentativa│
│  Al validar, su decisión se registra en el audit log             │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
   ClassificationResult
```

---

## Capa 1: Señales Definitivas

Señales de formato legal fijo argentino. No dependen de valores — son estructura invariable del sistema AFIP/ARCA.

```typescript
const DEFINITIVE_SIGNALS = [
  {
    // CAE: Código de Autorización Electrónica — AFIP, siempre 14 dígitos numéricos
    pattern: /\bCAE\s*N?[°º]?\s*:?\s*(\d{14})\b/i,
    documentType: 'FACTURA_COMPRA',  // se refina en Capa 4
    confidence: 97,
    validate: (match) => validateCAE(match[1]),  // checksum propio
  },
  {
    // Encabezado legal exacto — texto fijo por RG AFIP
    pattern: /\bFACTURA\s+[ABC]\b/i,
    documentType: 'FACTURA',
    confidence: 94,
    requiresCorroboration: ['CUIT'],  // necesita al menos un CUIT para 94
  },
  {
    pattern: /\bNOTA\s+DE\s+D[EÉ]BITO\s+[ABC]\b/i,
    documentType: 'NOTA_DEBITO',
    confidence: 96,
  },
  {
    pattern: /\bNOTA\s+DE\s+CR[EÉ]DITO\s+[ABC]\b/i,
    documentType: 'NOTA_CREDITO',
    confidence: 96,
  },
  {
    // Texto legal laboral fijo — Ley de Contrato de Trabajo
    pattern: /\bRECIBO\s+DE\s+SUELDO\b|\bLIQUIDACI[OÓ]N\s+DE\s+HABERES\b/i,
    documentType: 'LIQUIDACION_MOD',
    confidence: 98,
  },
  {
    // Remito: "R E M I T O" o "REMITO" en encabezado
    pattern: /^\s*R[\s.]?E[\s.]?M[\s.]?I[\s.]?T[\s.]?O\b/im,
    documentType: 'REMITO',
    confidence: 93,
    excludeIf: /\bCAE\b/i,  // si tiene CAE no es remito
  },
];
```

**Validación de CAE**: AFIP publica el algoritmo. Los primeros 8 dígitos son el número de CUIT de la empresa emisora sin guiones (parcial), los últimos 6 son un código de verificación. Podemos validar consistencia aunque no tengamos acceso al WS de AFIP.

---

## Capa 2: Señales Corroborantes

Sistema de puntuación acumulada. Cada señal es independiente. Las contradicciones penalizan.

### Señales positivas

```typescript
const CORROBORATING_SIGNALS: Signal[] = [
  // ── Indicadores de factura ─────────────────────────────────────
  { pattern: /\d{2}-\d{8}-\d/,                    pts: 12, type: 'FACTURA',        label: 'CUIT_FORMAT' },
  { pattern: /\bPUNTO\s+DE\s+VENTA\b/i,           pts: 15, type: 'FACTURA',        label: 'PTO_VENTA_HEADER' },
  { pattern: /\bCOMP\.\s*NRO\b|\bN[ÚU]MERO\s+DE\s+COMPROBANTE\b/i, pts: 10, type: 'FACTURA', label: 'COMP_NRO' },
  { pattern: /\bINGRESOS\s+BRUTOS\b/i,             pts: 8,  type: 'FACTURA',        label: 'IB_FIELD' },
  { pattern: /\bINICIO\s+DE\s+ACTIVIDADES\b/i,     pts: 8,  type: 'FACTURA',        label: 'INICIO_ACT' },
  { pattern: /\bCONDICI[OÓ]N\s+FRENTE\s+AL\s+IVA\b/i, pts: 10, type: 'FACTURA',   label: 'IVA_CONDITION' },

  // ── Indicadores de MOD ─────────────────────────────────────────
  { pattern: /\bANSES\b/i,                         pts: 20, type: 'LIQUIDACION_MOD', label: 'ANSES' },
  { pattern: /\bOBRA\s+SOCIAL\b/i,                 pts: 18, type: 'LIQUIDACION_MOD', label: 'OBRA_SOCIAL' },
  { pattern: /\bCUIL\b/,                           pts: 15, type: 'LIQUIDACION_MOD', label: 'CUIL_KEYWORD' },
  { pattern: /\bJUBILACI[OÓ]N\b|\bJUBILATORIO\b/i, pts: 18, type: 'LIQUIDACION_MOD', label: 'JUBILACION' },
  { pattern: /\bART\b.*\baccidente\b|\baccidente\b.*\bART\b/i, pts: 15, type: 'LIQUIDACION_MOD', label: 'ART' },
  { pattern: /\bSUELDO\s+B[AÁ]SICO\b|\bREMUNERACI[OÓ]N\s+B[AÁ]SICA\b/i, pts: 20, type: 'LIQUIDACION_MOD', label: 'SUELDO_BASICO' },
  { pattern: /\bHORAS\s+(EXTRA|TRABAJADAS|NORMALES)\b/i, pts: 15, type: 'LIQUIDACION_MOD', label: 'HORAS_WORKED' },

  // ── Indicadores de planilla de horas ──────────────────────────
  { pattern: /\bDEPARTAMENTO\b.*\bHORAS\b|\bHORAS\b.*\bDEPARTAMENTO\b/i, pts: 25, type: 'PLANILLA_HORAS', label: 'DEPT_HOURS' },
  { pattern: /\bTURNO\b.*\bJORNADA\b|\bJORNADA\b.*\bTURNO\b/i, pts: 20, type: 'PLANILLA_HORAS', label: 'TURNO_JORNADA' },
  { pattern: /\bHs?\.\s*\d+[\.,]\d{2}\b/,         pts: 15, type: 'PLANILLA_HORAS', label: 'HOURS_FORMAT' },

  // ── Indicadores de remito ─────────────────────────────────────
  { pattern: /\bREMITO\b/i,                        pts: 25, type: 'REMITO',         label: 'REMITO_KEYWORD' },
  { pattern: /\bFECHA\s+DE\s+(ENTREGA|REMISI[OÓ]N)\b/i, pts: 18, type: 'REMITO',   label: 'FECHA_ENTREGA' },
  { pattern: /\bTRANSPORTISTA\b|\bCHOFER\b/i,     pts: 15, type: 'REMITO',         label: 'TRANSPORTE' },
];
```

### Señales de contradicción (penalizaciones)

```typescript
const CONTRADICTIONS = [
  // Un remito no tiene CAE
  { if: 'REMITO_KEYWORD', and: 'CAE_FOUND', penalty: -30, reason: 'Remito no puede tener CAE' },
  // Una liquidación no tiene punto de venta AFIP
  { if: 'ANSES', and: 'PTO_VENTA_HEADER', penalty: -25, reason: 'Liquidación no tiene PtoVta' },
  // CUIL (personas) en una factura (empresas) es raro
  { if: 'CUIL_KEYWORD', and: 'CAE_FOUND', penalty: -15, reason: 'CUIL inusual en factura' },
];
```

---

## Capa 3: Validación Estructural Numérica

No determina el tipo — solo confirma o penaliza lo que Capa 2 sugirió.

```typescript
async function validateNumericStructure(text: string, suggestedType: string): Promise<number> {
  let delta = 0;

  // Validar CUIT (ya tenemos el algoritmo en el frontend — portarlo al backend)
  const cuitMatches = text.match(/\d{2}-\d{8}-\d/g) ?? [];
  const validCuits = cuitMatches.filter(c => validateCuitDigit(c));
  if (validCuits.length > 0) delta += 10;
  if (cuitMatches.length > 0 && validCuits.length === 0) delta -= 15; // CUIT formato pero inválido

  // Validar CAE: 14 dígitos consecutivos (no parte de otro número)
  const caeMatch = text.match(/\bCAE\s*N?[°º]?\s*:?\s*(\d{14})\b/i);
  if (caeMatch) {
    const isValid = validateCAEStructure(caeMatch[1]);
    delta += isValid ? 12 : -20;
  }

  // Fecha razonable: entre hoy y 10 años atrás
  const dateMatch = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (dateMatch) {
    const year = parseInt(dateMatch[3]);
    const now = new Date().getFullYear();
    delta += (year >= now - 10 && year <= now + 1) ? 5 : -10;
  }

  // Consistencia de totales: si hay tabla de ítems, la suma debe aproximarse al subtotal
  // (sin comparar valores específicos de alícuotas)
  const lineItemTotals = extractLineItemTotals(text);
  if (lineItemTotals.length > 0) {
    const itemsSum = lineItemTotals.reduce((a, b) => a + b, 0);
    const subtotalMatch = extractSubtotal(text);
    if (subtotalMatch && Math.abs(itemsSum - subtotalMatch) / subtotalMatch < 0.02) {
      delta += 8; // coinciden dentro del 2%
    }
  }

  return delta;
}
```

**Validación de estructura CAE**: AFIP publica que los primeros 8 dígitos del CAE corresponden al CUIT sin guiones del emisor (primeros 8 dígitos). Podemos cruzarlo contra el CUIT del encabezado del documento para validar consistencia sin necesitar internet.

---

## Capa 4: Business Routing (sección de costos)

Una vez que el tipo está clasificado, determinamos la sección. Esta es la capa más semántica.

```typescript
const COST_SECTION_RULES: CostSectionRule[] = [
  // Facturas de venta → siempre Ventas
  { documentType: 'FACTURA_VENTA', section: 'VENTAS', confidence: 99 },
  // Liquidaciones y planillas → siempre MOD
  { documentType: 'LIQUIDACION_MOD', section: 'MANO_DE_OBRA', confidence: 99 },
  { documentType: 'PLANILLA_HORAS',  section: 'MANO_DE_OBRA', confidence: 99 },
  // Remitos salida → Ventas; entrada → MP (necesita distinguir)
  { documentType: 'REMITO', section: null, requiresSemanticAnalysis: true },

  // Facturas de compra → MP o CIP (el caso más complejo)
  {
    documentType: 'FACTURA_COMPRA',
    section: null,
    subRules: [
      // Señales fuertes de MP
      { keywords: ['materia prima', 'insumo', 'material', 'kg', 'litro', 'tonelada', 'bobina', 'rollo', 'envase'], section: 'MATERIA_PRIMA', pts: 25 },
      // Señales fuertes de CIP
      { keywords: ['alquiler', 'servicio', 'energía', 'electricidad', 'gas', 'mantenimiento', 'seguro', 'limpieza', 'vigilancia'], section: 'COSTOS_INDIRECTOS', pts: 25 },
      // Si ninguna matchea con confianza → Groq decide
    ],
  },
];
```

**Distinción remito entrada/salida**: los remitos de entrada (compra de MP) tienen el proveedor como emisor y la empresa como receptor. Los de salida es al revés. Identificable por posición de CUITs en el encabezado.

---

## Feature extra: Fingerprinting de proveedores (gran diferenciador)

Esta funcionalidad eleva la confianza dramáticamente con el tiempo:

```
tabla: SupplierFingerprint
  - cuit            (único por proveedor)
  - documentType    (tipo que emite siempre)
  - costSection     (sección donde siempre va)
  - timesSeenCorrect
  - timesOverridden
  - confidenceBonus (calculado: timesSeenCorrect / total * 30)
  - updatedAt
```

**Cómo funciona**: la primera vez que llega una factura del CUIT 30-71234567-9 (ejemplo: Metrogas), el clasificador trabaja normalmente. El costista la valida como CIP. El sistema guarda ese CUIT → CIP. La próxima factura de ese CUIT llega con +25 pts de confianza directo → en la mayoría de los casos supera el umbral sin necesitar AI.

Con el tiempo, el sistema "aprende" la cartera de proveedores de cada empresa sin ML formal — puro fingerprinting determinista.

**Impacto estimado en confianza**: después de 20 facturas procesadas de una empresa, el 60–70% de los documentos nuevos llegan con proveedor conocido → confianza automática ≥ 95% desde Capa 1 extendida.

---

## Feature extra: Detección de duplicados

Antes de clasificar, verificar si el CAE ya fue procesado:

```
tabla: ProcessedCAE
  - cae (string, unique)
  - dataEntryId (FK)
  - companyId
  - processedAt
```

Si el CAE ya existe → el operario recibe aviso inmediato "Este documento ya fue enviado el DD/MM/AAAA". El costista no ve duplicado, el operario lo sabe al instante.

---

## Capa 5: Groq AI Fallback

Solo para documentos con confianza < 72 después de las 4 capas anteriores.

El prompt incluye explícitamente las señales encontradas para que el AI no repita el trabajo:

```
Contexto: documento contable argentino.
Señales encontradas por el clasificador de reglas:
- CUIL_KEYWORD (18 pts)
- HORAS_WORKED (15 pts)
- Sin CAE, sin PTO_VENTA_HEADER
Confianza acumulada: 33/100

Texto del documento:
[texto aquí]

Clasificá este documento. Los tipos posibles son: FACTURA_COMPRA, FACTURA_VENTA,
REMITO, LIQUIDACION_MOD, PLANILLA_HORAS, NOTA_DEBITO, OTRO.
La sección de costos posible: MATERIA_PRIMA, MANO_DE_OBRA, COSTOS_INDIRECTOS, VENTAS.
Respondé SOLO con JSON válido.
```

---

## Audit Log

Cada clasificación genera un registro inmutable:

```typescript
interface ClassificationAudit {
  id: string;
  dataEntryId: string;
  companyId: string;

  // Pipeline results
  qualityGate: 'PASS' | 'PARTIAL' | 'FAIL';
  definitiveSignal: string | null;       // qué señal de Capa 1 disparó (si alguna)
  corroboratingSignals: SignalResult[];  // todas las señales de Capa 2
  numericValidationDelta: number;        // +/- de Capa 3
  supplierFingerprintUsed: boolean;      // ¿usó proveedor conocido?
  aiUsed: boolean;                       // ¿llegó a Capa 5?

  // Final result
  documentType: DocumentType;
  costSection: CostSection;
  confidence: number;
  requiresReview: boolean;

  // Human validation
  validatedByCostista: boolean;
  costaValidatedAt: Date | null;
  costaOverrode: boolean;                // ¿el costista cambió la clasificación?
  costaCorrection: { type?: string; section?: string } | null;

  createdAt: Date;
}
```

---

## Targets de confianza por tipo de documento

| Tipo | Confianza esperada | Señal definitiva |
|------|-------------------|-----------------|
| FACTURA (con CAE) | 97% | CAE 14 dígitos |
| LIQUIDACION_MOD | 98% | "RECIBO DE SUELDO" |
| NOTA_DEBITO | 96% | "NOTA DE DÉBITO [A-C]" |
| PLANILLA_HORAS | 88% | Combinación dept+horas |
| REMITO | 91% | "REMITO" + ausencia CAE |
| FACTURA sin CAE | 82% | Corroboración múltiple |
| Con fingerprint proveedor | +15–25 bonus | Proveedor conocido |

**Sección de costos (una vez clasificado el tipo):**
| Sección | Confianza |
|---------|-----------|
| VENTAS (factura venta / remito salida) | 99% |
| MANO_DE_OBRA (liquidación / planilla) | 99% |
| MP vs CIP (factura compra) | 87% reglas, 94% con AI |

---

## Archivos a crear/modificar

```
CosteAR-backend/src/
├── infrastructure/
│   ├── ai/
│   │   └── groq-service.ts              (modificar — mejorar prompt con señales)
│   └── classifier/                       (nuevo módulo)
│       ├── cascade-classifier.ts         (orchestrator principal)
│       ├── layers/
│       │   ├── layer0-quality-gate.ts
│       │   ├── layer1-definitive-signals.ts
│       │   ├── layer2-corroborating-signals.ts
│       │   ├── layer3-numeric-validation.ts
│       │   ├── layer4-business-routing.ts
│       │   └── layer5-ai-fallback.ts
│       ├── signals/
│       │   ├── definitive-signals.config.ts
│       │   └── corroborating-signals.config.ts
│       └── utils/
│           ├── cuit-validator.ts
│           ├── cae-validator.ts
│           └── text-extractor.ts
├── application/
│   └── empresa/
│       └── empresa-portal-service.ts    (modificar — usar classifier)
└── prisma/
    └── schema.prisma                    (agregar SupplierFingerprint, ClassificationAudit, ProcessedCAE)
```

---

## Lo que ve cada actor

**Operario**: solo "✓ Documento recibido" o "⚠ Imagen borrosa, por favor reenviar con mejor calidad". Nunca ve la clasificación ni los datos técnicos.

**Costista**: ve el resultado completo — tipo detectado, sección de costos, confianza, señales activadas. Puede aprobar con un click o corregir. Al aprobar → los datos extraídos se aplican automáticamente a la estructura de costos de esa empresa.

---

## Criterio de éxito

- Confianza ≥ 95% en documentos con CAE presente (>50% del volumen esperado)
- Confianza ≥ 90% en liquidaciones y planillas
- Tasa de escalación a revisión manual < 15% en el primer mes, < 5% después de 3 meses de fingerprinting activo
- Cero casos donde datos incorrectos se aplican a la DB (el costista siempre valida antes de aplicar)
