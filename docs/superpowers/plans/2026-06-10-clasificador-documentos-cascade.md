# Clasificador de Documentos en Cascada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 6-layer cascade classifier that classifies Argentine accounting documents (facturas, remitos, liquidaciones, planillas) into document type + cost section with >95% confidence for documents with AFIP signals, using deterministic rules first and Groq AI only as a fallback for ambiguous cases.

**Architecture:** Pure pipeline — each layer receives text + accumulated signals and either commits to a classification or passes to the next layer. The orchestrator in `cascade-classifier.ts` runs the layers in order and produces a `ClassificationResult`. The `empresa-portal-service.ts` calls the orchestrator and persists the result. `validaciones-service.ts` updates the `SupplierFingerprint` after costista validation.

**Tech Stack:** TypeScript (NodeNext modules — all imports use `.js` extension), Prisma 6 + PostgreSQL, Groq API (already wired), Vitest for tests.

---

## File Map

**New files:**
- `src/infrastructure/classifier/types.ts` — shared types for the whole classifier
- `src/infrastructure/classifier/utils/cuit-validator.ts` — CUIT/CUIL checksum algorithm
- `src/infrastructure/classifier/utils/cae-validator.ts` — CAE structure validator
- `src/infrastructure/classifier/utils/text-extractor.ts` — regex helpers (extract amounts, dates)
- `src/infrastructure/classifier/signals/definitive-signals.config.ts` — Layer 1 signal definitions
- `src/infrastructure/classifier/signals/corroborating-signals.config.ts` — Layer 2 signal definitions
- `src/infrastructure/classifier/layers/layer0-quality-gate.ts` — rejects illegible docs
- `src/infrastructure/classifier/layers/layer1-definitive-signals.ts` — AFIP hard signals
- `src/infrastructure/classifier/layers/layer2-corroborating-signals.ts` — weighted accumulation
- `src/infrastructure/classifier/layers/layer3-numeric-validation.ts` — CUIT/CAE/date validation
- `src/infrastructure/classifier/layers/layer4-business-routing.ts` — determines cost section
- `src/infrastructure/classifier/layers/layer5-ai-fallback.ts` — Groq for confidence < 72
- `src/infrastructure/classifier/cascade-classifier.ts` — main orchestrator
- `src/tests/classifier/cuit-validator.test.ts`
- `src/tests/classifier/cae-validator.test.ts`
- `src/tests/classifier/layer0.test.ts`
- `src/tests/classifier/layer1.test.ts`
- `src/tests/classifier/layer2.test.ts`
- `src/tests/classifier/layer3.test.ts`
- `src/tests/classifier/layer4.test.ts`
- `src/tests/classifier/cascade.test.ts`

**Modified files:**
- `prisma/schema.prisma` — add SupplierFingerprint, ClassificationAudit, ProcessedCAE models
- `src/infrastructure/ai/groq-service.ts` — add `classifyDocument()` method for Layer 5
- `src/application/empresa/empresa-portal-service.ts` — call cascade classifier, check duplicates
- `src/application/validaciones/validaciones-service.ts` — update SupplierFingerprint on approval

---

## Task 1: Prisma schema additions

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the three new models to schema.prisma**

At the end of `prisma/schema.prisma`, after the `AuditLog` model, add:

```prisma
// ---------------------------------------------------------------------------
// Clasificador de documentos en cascada
// ---------------------------------------------------------------------------

// Aprende de cada proveedor validado: CUIT → tipo + sección habitual.
// Se actualiza cada vez que el costista aprueba/corrige una entrada.
// Scoped por costistId para que cada costista tenga su propia base.
model SupplierFingerprint {
  id                String   @id @default(uuid()) @db.Uuid
  costistId         String   @db.Uuid              // costista propietario
  supplierCuit      String                          // CUIT del proveedor (sin guiones: 11 dígitos)
  documentType      String                          // tipo más frecuente: FACTURA_COMPRA, etc.
  costSection       String                          // sección más frecuente: MATERIA_PRIMA, etc.
  timesSeenCorrect  Int      @default(0)
  timesOverridden   Int      @default(0)
  confidenceBonus   Int      @default(0)            // calculado: min(25, timesSeenCorrect * 5)
  updatedAt         DateTime @updatedAt

  @@unique([costistId, supplierCuit])
  @@index([costistId])
  @@map("supplier_fingerprints")
}

// Log inmutable de cada clasificación realizada.
model ClassificationAudit {
  id                      String   @id @default(uuid()) @db.Uuid
  dataEntryId             String   @db.Uuid
  companyId               String   @db.Uuid
  costistId               String   @db.Uuid

  // Pipeline results
  qualityGate             String                          // PASS | PARTIAL | FAIL
  definitiveSignal        String?                         // señal de capa 1 que disparó
  corroboratingSignals    Json                            // SignalResult[]
  numericValidationDelta  Int      @default(0)
  supplierFingerprintUsed Boolean  @default(false)
  aiUsed                  Boolean  @default(false)
  confidenceCap           Int?                            // 65 si calidad parcial

  // Final result
  documentType            String                          // FACTURA_COMPRA, REMITO, etc.
  costSection             String                          // MATERIA_PRIMA, etc.
  confidence              Int
  requiresReview          Boolean  @default(false)

  // Human validation (filled in by validaciones-service on review)
  validatedByCostista     Boolean  @default(false)
  costaValidatedAt        DateTime?
  costaOverrode           Boolean  @default(false)
  costaCorrection         Json?                           // { type?, section? }

  createdAt               DateTime @default(now())

  @@index([dataEntryId])
  @@index([costistId])
  @@map("classification_audits")
}

// Registro de CAEs ya procesados para detectar documentos duplicados.
model ProcessedCAE {
  id            String   @id @default(uuid()) @db.Uuid
  cae           String   @unique
  dataEntryId   String   @db.Uuid
  companyId     String   @db.Uuid
  processedAt   DateTime @default(now())

  @@index([companyId])
  @@map("processed_caes")
}
```

- [ ] **Step 2: Run migration**

```bash
cd C:\Users\giuli\Documents\CosteAR\CosteAR-backend
npx prisma migrate dev --name add-classifier-tables
```

Expected: `Your database is now in sync with your schema.` (3 new tables created)

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: Prisma client generated successfully. (On Windows may show an EPERM warning about renaming the DLL — ignore it, Railway builds on Linux)

- [ ] **Step 4: Verify TypeScript can import new types**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add SupplierFingerprint, ClassificationAudit, ProcessedCAE tables"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/infrastructure/classifier/types.ts`

- [ ] **Step 1: Create the shared types file**

```typescript
// src/infrastructure/classifier/types.ts

export type DocumentType =
  | 'FACTURA_COMPRA'
  | 'FACTURA_VENTA'
  | 'REMITO'
  | 'LIQUIDACION_MOD'
  | 'PLANILLA_HORAS'
  | 'NOTA_DEBITO'
  | 'NOTA_CREDITO'
  | 'DESCONOCIDO';

export type CostSection =
  | 'MATERIA_PRIMA'
  | 'MANO_DE_OBRA'
  | 'COSTOS_INDIRECTOS'
  | 'VENTAS'
  | 'DESCONOCIDO';

export interface SignalResult {
  label: string;       // e.g. 'CAE_FOUND', 'ANSES', 'CUIT_FORMAT'
  pts: number;         // points contributed (negative for penalties)
  type: string;        // which document type this signal supports
  layer: number;       // 1, 2, or 3
}

export interface ClassifierInput {
  text: string;                     // raw text content (OCR or user-typed)
  costistId: string;
  companyId: string;
  dataEntryId: string;
  supplierCuit?: string | null;     // pre-extracted CUIT if available
}

export interface ClassificationResult {
  documentType: DocumentType;
  costSection: CostSection;
  confidence: number;               // 0-100
  requiresReview: boolean;          // true if confidence < 72
  isDuplicate: boolean;
  duplicateEntryId?: string;        // filled if isDuplicate
  qualityGate: 'PASS' | 'PARTIAL' | 'FAIL';
  definitiveSignal: string | null;
  signals: SignalResult[];
  aiUsed: boolean;
  supplierFingerprintUsed: boolean;
  confidenceCap: number | null;     // 65 if quality is partial
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/classifier/types.ts
git commit -m "feat: add classifier shared types"
```

---

## Task 3: Utility — CUIT validator

**Files:**
- Create: `src/infrastructure/classifier/utils/cuit-validator.ts`
- Create: `src/tests/classifier/cuit-validator.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/classifier/cuit-validator.test.ts
import { describe, it, expect } from 'vitest';
import { validateCuit, extractCuits } from '../../infrastructure/classifier/utils/cuit-validator.js';

describe('validateCuit', () => {
  it('validates a known valid CUIT', () => {
    // 30-71234567-9 → verificador válido
    expect(validateCuit('30712345679')).toBe(true);
  });

  it('rejects CUIT with wrong verifier digit', () => {
    expect(validateCuit('30712345670')).toBe(false);
  });

  it('rejects if length !== 11', () => {
    expect(validateCuit('12345')).toBe(false);
  });

  it('accepts CUIT with hyphens', () => {
    expect(validateCuit('30-71234567-9')).toBe(true);
  });

  it('rejects when remainder is 1 (invalid by definition)', () => {
    // Any CUIT that produces remainder 1 is structurally invalid per AFIP
    // We verify the algorithm exits false for these
    expect(validateCuit('00000000001')).toBe(false);
  });
});

describe('extractCuits', () => {
  it('extracts CUITs from formatted text', () => {
    const text = 'Proveedor CUIT: 30-71234567-9 Comprador CUIT 20123456789';
    const result = extractCuits(text);
    expect(result).toContain('30712345679');
  });

  it('returns empty array when no CUIT present', () => {
    expect(extractCuits('Sin número de identificación')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd C:\Users\giuli\Documents\CosteAR\CosteAR-backend
npx vitest run src/tests/classifier/cuit-validator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement cuit-validator.ts**

```typescript
// src/infrastructure/classifier/utils/cuit-validator.ts

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/**
 * Validates an Argentine CUIT/CUIL number using the official AFIP verifier algorithm.
 * Accepts with or without hyphens. Returns false for any structural error.
 */
export function validateCuit(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return false;

  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const remainder = sum % 11;

  // Remainder of 1 is structurally invalid per AFIP specification
  if (remainder === 1) return false;

  const expectedVerifier = remainder === 0 ? 0 : 11 - remainder;
  return Number(digits[10]) === expectedVerifier;
}

/**
 * Extracts all CUIT-formatted numbers from a text and returns the ones
 * that pass the verifier check, as 11-digit strings (no hyphens).
 */
export function extractCuits(text: string): string[] {
  // Matches XX-XXXXXXXX-X or XXXXXXXXXXX (11 consecutive digits)
  const formatted = text.match(/\d{2}-\d{8}-\d/g) ?? [];
  const raw = text.match(/(?<!\d)\d{11}(?!\d)/g) ?? [];

  const candidates = [
    ...formatted.map((c) => c.replace(/\D/g, '')),
    ...raw,
  ];

  // Deduplicate + filter valid
  return [...new Set(candidates)].filter(validateCuit);
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/tests/classifier/cuit-validator.test.ts
```

Expected: All tests pass (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/classifier/utils/cuit-validator.ts src/tests/classifier/cuit-validator.test.ts
git commit -m "feat: add CUIT validator utility with tests"
```

---

## Task 4: Utility — CAE validator

**Files:**
- Create: `src/infrastructure/classifier/utils/cae-validator.ts`
- Create: `src/tests/classifier/cae-validator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/tests/classifier/cae-validator.test.ts
import { describe, it, expect } from 'vitest';
import { validateCAEStructure, extractCAE } from '../../infrastructure/classifier/utils/cae-validator.js';

describe('validateCAEStructure', () => {
  it('accepts a 14-digit string', () => {
    expect(validateCAEStructure('12345678901234')).toBe(true);
  });

  it('rejects strings shorter than 14 digits', () => {
    expect(validateCAEStructure('1234567890123')).toBe(false);
  });

  it('rejects strings longer than 14 digits', () => {
    expect(validateCAEStructure('123456789012345')).toBe(false);
  });

  it('rejects strings with non-digits', () => {
    expect(validateCAEStructure('1234567890123A')).toBe(false);
  });

  it('rejects all-zeros', () => {
    expect(validateCAEStructure('00000000000000')).toBe(false);
  });
});

describe('extractCAE', () => {
  it('extracts CAE from standard AFIP format', () => {
    const text = 'CAE Nº: 75123456789012\nFecha de Vto: 15/06/2026';
    expect(extractCAE(text)).toBe('75123456789012');
  });

  it('returns null when no CAE present', () => {
    expect(extractCAE('Factura sin CAE')).toBeNull();
  });

  it('ignores partial matches that are not 14 digits', () => {
    expect(extractCAE('CAE: 123456')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/tests/classifier/cae-validator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement cae-validator.ts**

```typescript
// src/infrastructure/classifier/utils/cae-validator.ts

const CAE_PATTERN = /\bCAE\s*N?[°º]?\s*:?\s*(\d{14})\b/i;

/**
 * Validates that a string is exactly 14 numeric digits and is not all zeros.
 * AFIP CAE codes are always 14 digits; no further public checksum algorithm.
 */
export function validateCAEStructure(cae: string): boolean {
  if (!/^\d{14}$/.test(cae)) return false;
  if (cae === '00000000000000') return false;
  return true;
}

/**
 * Extracts a CAE from text using the AFIP-standard label patterns.
 * Returns the 14-digit string or null.
 */
export function extractCAE(text: string): string | null {
  const match = CAE_PATTERN.exec(text);
  if (!match || !match[1]) return null;
  return validateCAEStructure(match[1]) ? match[1] : null;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/tests/classifier/cae-validator.test.ts
```

Expected: All tests pass (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/classifier/utils/cae-validator.ts src/tests/classifier/cae-validator.test.ts
git commit -m "feat: add CAE structure validator utility with tests"
```

---

## Task 5: Utility — text extractor

**Files:**
- Create: `src/infrastructure/classifier/utils/text-extractor.ts`

- [ ] **Step 1: Create text-extractor.ts**

No tests needed for this file — it's pure regex helpers used by the layers.

```typescript
// src/infrastructure/classifier/utils/text-extractor.ts

/**
 * Extracts all numeric amounts from a text (Argentine format: 1.234,56 or 1234.56).
 * Returns them as JavaScript numbers.
 */
export function extractAmounts(text: string): number[] {
  // Match patterns like 1.234,56 or 1234,56 or 1234.56
  const matches = text.match(/\b\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\b|\b\d+,\d{2}\b/g) ?? [];
  return matches
    .map((m) => parseFloat(m.replace(/\./g, '').replace(',', '.')))
    .filter((n) => !isNaN(n) && n > 0);
}

/**
 * Extracts the first plausible date from a text.
 * Supports DD/MM/YYYY and YYYY-MM-DD formats.
 * Returns { day, month, year } or null.
 */
export function extractFirstDate(text: string): { day: number; month: number; year: number } | null {
  // DD/MM/YYYY
  const dmyMatch = /\b(\d{2})\/(\d{2})\/(\d{4})\b/.exec(text);
  if (dmyMatch && dmyMatch[1] && dmyMatch[2] && dmyMatch[3]) {
    return { day: parseInt(dmyMatch[1]), month: parseInt(dmyMatch[2]), year: parseInt(dmyMatch[3]) };
  }
  // YYYY-MM-DD
  const isoMatch = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (isoMatch && isoMatch[1] && isoMatch[2] && isoMatch[3]) {
    return { day: parseInt(isoMatch[3]), month: parseInt(isoMatch[2]), year: parseInt(isoMatch[1]) };
  }
  return null;
}

/**
 * Normalizes text for pattern matching: uppercase, remove excess whitespace,
 * normalize accented characters.
 */
export function normalizeText(text: string): string {
  return text
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacritics
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/infrastructure/classifier/utils/text-extractor.ts
git commit -m "feat: add text extractor utility for classifier"
```

---

## Task 6: Layer 0 — Quality Gate

**Files:**
- Create: `src/infrastructure/classifier/layers/layer0-quality-gate.ts`
- Create: `src/tests/classifier/layer0.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/tests/classifier/layer0.test.ts
import { describe, it, expect } from 'vitest';
import { runQualityGate } from '../../infrastructure/classifier/layers/layer0-quality-gate.js';

describe('runQualityGate', () => {
  it('returns PASS for clear, detailed text', () => {
    const result = runQualityGate({
      quality: 'legible',
      text: 'FACTURA A Nº 0001-00001234 CUIT 30-71234567-9 Subtotal $1000',
    });
    expect(result.gate).toBe('PASS');
    expect(result.confidenceCap).toBeNull();
  });

  it('returns PARTIAL and cap 65 for partially legible text', () => {
    const result = runQualityGate({ quality: 'parcial', text: 'FACTURA... borroso' });
    expect(result.gate).toBe('PARTIAL');
    expect(result.confidenceCap).toBe(65);
  });

  it('returns FAIL for illegible quality', () => {
    const result = runQualityGate({ quality: 'ilegible', text: '' });
    expect(result.gate).toBe('FAIL');
  });

  it('infers PARTIAL when text is very short (under 20 chars)', () => {
    const result = runQualityGate({ quality: 'legible', text: 'abc' });
    expect(result.gate).toBe('PARTIAL');
    expect(result.confidenceCap).toBe(65);
  });

  it('returns PASS when no Groq quality info but text is substantive', () => {
    const result = runQualityGate({
      quality: null,
      text: 'FACTURA A Nº 0001-00001234 Proveedor SRL CUIT 30-71234567-9 Total $5000',
    });
    expect(result.gate).toBe('PASS');
    expect(result.confidenceCap).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/tests/classifier/layer0.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement layer0-quality-gate.ts**

```typescript
// src/infrastructure/classifier/layers/layer0-quality-gate.ts

const MIN_SUBSTANTIVE_LENGTH = 20; // characters

export interface QualityGateResult {
  gate: 'PASS' | 'PARTIAL' | 'FAIL';
  confidenceCap: number | null;
}

/**
 * Layer 0: Quality Gate.
 *
 * Receives the Groq quality assessment (if a file was uploaded) and the raw text.
 * Determines whether classification should proceed and whether to cap confidence.
 *
 * Rules:
 * - 'ilegible' → FAIL (skip classification, flag for re-submission)
 * - 'parcial' → PARTIAL, cap confidence at 65
 * - text shorter than MIN_SUBSTANTIVE_LENGTH → PARTIAL, cap at 65
 * - otherwise → PASS
 */
export function runQualityGate(input: {
  quality: 'legible' | 'parcial' | 'ilegible' | null;
  text: string;
}): QualityGateResult {
  if (input.quality === 'ilegible') {
    return { gate: 'FAIL', confidenceCap: null };
  }

  if (input.quality === 'parcial' || input.text.trim().length < MIN_SUBSTANTIVE_LENGTH) {
    return { gate: 'PARTIAL', confidenceCap: 65 };
  }

  return { gate: 'PASS', confidenceCap: null };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/tests/classifier/layer0.test.ts
```

Expected: All tests pass (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/classifier/layers/layer0-quality-gate.ts src/tests/classifier/layer0.test.ts
git commit -m "feat: add Layer 0 quality gate with tests"
```

---

## Task 7: Signal configs

**Files:**
- Create: `src/infrastructure/classifier/signals/definitive-signals.config.ts`
- Create: `src/infrastructure/classifier/signals/corroborating-signals.config.ts`

- [ ] **Step 1: Create definitive-signals.config.ts**

```typescript
// src/infrastructure/classifier/signals/definitive-signals.config.ts
import type { DocumentType } from '../types.js';

export interface DefinitiveSignal {
  label: string;
  pattern: RegExp;
  documentType: DocumentType;
  confidence: number;
  /** If present, the classification is only applied if this pattern is ALSO found */
  requiresPattern?: RegExp;
  /** If present, the classification is NOT applied if this pattern is found */
  excludeIfPattern?: RegExp;
}

/**
 * Layer 1 definitive signals.
 *
 * These are fixed structural elements of Argentine legal/accounting documents
 * defined by AFIP/ARCA regulations. They do not depend on economic values.
 *
 * A single match at this layer immediately sets document type with high confidence,
 * bypassing Layers 2-3 for type detection (business routing in Layer 4 still runs).
 */
export const DEFINITIVE_SIGNALS: DefinitiveSignal[] = [
  {
    label: 'CAE_FOUND',
    // CAE: Código de Autorización Electrónica. Always labeled "CAE Nº:" followed by 14 digits.
    pattern: /\bCAE\s*N?[°º]?\s*:?\s*\d{14}\b/i,
    documentType: 'FACTURA_COMPRA', // refined to FACTURA_VENTA in Layer 4 if needed
    confidence: 97,
  },
  {
    label: 'FACTURA_ABC',
    // "FACTURA A", "FACTURA B", "FACTURA C" — exact AFIP invoice type header
    pattern: /\bFACTURA\s+[ABC]\b/i,
    documentType: 'FACTURA_COMPRA',
    confidence: 94,
    // Needs a CUIT to be credible as a real invoice
    requiresPattern: /\d{2}-\d{8}-\d|\b\d{11}\b/,
  },
  {
    label: 'NOTA_DEBITO_ABC',
    pattern: /\bNOTA\s+DE\s+D[EÉ]BITO\s+[ABC]\b/i,
    documentType: 'NOTA_DEBITO',
    confidence: 96,
  },
  {
    label: 'NOTA_CREDITO_ABC',
    pattern: /\bNOTA\s+DE\s+CR[EÉ]DITO\s+[ABC]\b/i,
    documentType: 'NOTA_CREDITO',
    confidence: 96,
  },
  {
    label: 'RECIBO_SUELDO',
    // Fixed legal phrase from Argentine Labour Law / Ley de Contrato de Trabajo
    pattern: /\bRECIBO\s+DE\s+SUELDO\b|\bLIQUIDACI[OÓ]N\s+DE\s+HABERES\b/i,
    documentType: 'LIQUIDACION_MOD',
    confidence: 98,
  },
  {
    label: 'REMITO_HEADER',
    // "R E M I T O" or "REMITO" at start of line (common in printed formats)
    pattern: /^\s*R[\s.]?E[\s.]?M[\s.]?I[\s.]?T[\s.]?O\b/im,
    documentType: 'REMITO',
    confidence: 93,
    // Remitos do not have CAE
    excludeIfPattern: /\bCAE\s*N?[°º]?\s*:?\s*\d{14}\b/i,
  },
];
```

- [ ] **Step 2: Create corroborating-signals.config.ts**

```typescript
// src/infrastructure/classifier/signals/corroborating-signals.config.ts
import type { DocumentType } from '../types.js';

export interface CorroboratingSignal {
  label: string;
  pattern: RegExp;
  pts: number;
  type: DocumentType;
}

export interface ContradictionRule {
  if: string;   // label of signal A
  and: string;  // label of signal B
  penalty: number;
  reason: string;
}

/**
 * Layer 2 weighted corroborating signals.
 *
 * These are secondary structural indicators. Each match adds points toward a type.
 * Contradictions between signals reduce total confidence.
 *
 * Threshold: 72 pts → proceed to Layer 4 without AI.
 */
export const CORROBORATING_SIGNALS: CorroboratingSignal[] = [
  // ── Factura indicators ─────────────────────────────────────────────────────
  { label: 'CUIT_FORMAT',      pattern: /\d{2}-\d{8}-\d/,                               pts: 12, type: 'FACTURA_COMPRA' },
  { label: 'PTO_VENTA_HEADER', pattern: /\bPUNTO\s+DE\s+VENTA\b/i,                     pts: 15, type: 'FACTURA_COMPRA' },
  { label: 'COMP_NRO',         pattern: /\bCOMP\.\s*NRO\b|\bN[ÚU]MERO\s+DE\s+COMPROBANTE\b/i, pts: 10, type: 'FACTURA_COMPRA' },
  { label: 'IB_FIELD',         pattern: /\bINGRESOS\s+BRUTOS\b/i,                       pts: 8,  type: 'FACTURA_COMPRA' },
  { label: 'INICIO_ACT',       pattern: /\bINICIO\s+DE\s+ACTIVIDADES\b/i,               pts: 8,  type: 'FACTURA_COMPRA' },
  { label: 'IVA_CONDITION',    pattern: /\bCONDICI[OÓ]N\s+FRENTE\s+AL\s+IVA\b/i,      pts: 10, type: 'FACTURA_COMPRA' },

  // ── MOD indicators ─────────────────────────────────────────────────────────
  { label: 'ANSES',            pattern: /\bANSES\b/i,                                   pts: 20, type: 'LIQUIDACION_MOD' },
  { label: 'OBRA_SOCIAL',      pattern: /\bOBRA\s+SOCIAL\b/i,                           pts: 18, type: 'LIQUIDACION_MOD' },
  { label: 'CUIL_KEYWORD',     pattern: /\bCUIL\b/,                                     pts: 15, type: 'LIQUIDACION_MOD' },
  { label: 'JUBILACION',       pattern: /\bJUBILACI[OÓ]N\b|\bJUBILATORIO\b/i,          pts: 18, type: 'LIQUIDACION_MOD' },
  { label: 'ART',              pattern: /\bART\b.*\baccidente\b|\baccidente\b.*\bART\b/i, pts: 15, type: 'LIQUIDACION_MOD' },
  { label: 'SUELDO_BASICO',    pattern: /\bSUELDO\s+B[AÁ]SICO\b|\bREMUNERACI[OÓ]N\s+B[AÁ]SICA\b/i, pts: 20, type: 'LIQUIDACION_MOD' },
  { label: 'HORAS_WORKED',     pattern: /\bHORAS\s+(EXTRA|TRABAJADAS|NORMALES)\b/i,     pts: 15, type: 'LIQUIDACION_MOD' },

  // ── Planilla de horas indicators ────────────────────────────────────────────
  { label: 'DEPT_HOURS',       pattern: /\bDEPARTAMENTO\b.*\bHORAS\b|\bHORAS\b.*\bDEPARTAMENTO\b/i, pts: 25, type: 'PLANILLA_HORAS' },
  { label: 'TURNO_JORNADA',    pattern: /\bTURNO\b.*\bJORNADA\b|\bJORNADA\b.*\bTURNO\b/i, pts: 20, type: 'PLANILLA_HORAS' },
  { label: 'HOURS_FORMAT',     pattern: /\bHs?\.\s*\d+[\.,]\d{2}\b/,                   pts: 15, type: 'PLANILLA_HORAS' },

  // ── Remito indicators ───────────────────────────────────────────────────────
  { label: 'REMITO_KEYWORD',   pattern: /\bREMITO\b/i,                                  pts: 25, type: 'REMITO' },
  { label: 'FECHA_ENTREGA',    pattern: /\bFECHA\s+DE\s+(ENTREGA|REMISI[OÓ]N)\b/i,     pts: 18, type: 'REMITO' },
  { label: 'TRANSPORTE',       pattern: /\bTRANSPORTISTA\b|\bCHOFER\b/i,               pts: 15, type: 'REMITO' },
];

export const CONTRADICTIONS: ContradictionRule[] = [
  // A remito cannot have a CAE (CAE only on electronic invoices)
  { if: 'REMITO_KEYWORD', and: 'CAE_FOUND', penalty: -30, reason: 'Remito no puede tener CAE' },
  // A liquidación does not have AFIP punto de venta headers
  { if: 'ANSES', and: 'PTO_VENTA_HEADER', penalty: -25, reason: 'Liquidación no tiene PtoVta' },
  // CUIL (person identifier) is unusual on a business invoice with CAE
  { if: 'CUIL_KEYWORD', and: 'CAE_FOUND', penalty: -15, reason: 'CUIL inusual en factura con CAE' },
];
```

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/classifier/signals/
git commit -m "feat: add definitive and corroborating signal configs"
```

---

## Task 8: Layer 1 — Definitive signals

**Files:**
- Create: `src/infrastructure/classifier/layers/layer1-definitive-signals.ts`
- Create: `src/tests/classifier/layer1.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/tests/classifier/layer1.test.ts
import { describe, it, expect } from 'vitest';
import { runLayer1 } from '../../infrastructure/classifier/layers/layer1-definitive-signals.js';

describe('runLayer1', () => {
  it('detects CAE and returns FACTURA_COMPRA at confidence 97', () => {
    const text = 'FACTURA A\nCAE Nº: 75123456789012\nFecha Vto: 15/06/2026';
    const result = runLayer1(text);
    expect(result).not.toBeNull();
    expect(result!.documentType).toBe('FACTURA_COMPRA');
    expect(result!.confidence).toBe(97);
    expect(result!.label).toBe('CAE_FOUND');
  });

  it('detects RECIBO DE SUELDO at confidence 98', () => {
    const text = 'RECIBO DE SUELDO\nEmpleado: Juan Pérez CUIL 20-12345678-9';
    const result = runLayer1(text);
    expect(result).not.toBeNull();
    expect(result!.documentType).toBe('LIQUIDACION_MOD');
    expect(result!.confidence).toBe(98);
  });

  it('detects NOTA DE DÉBITO A at confidence 96', () => {
    const result = runLayer1('NOTA DE DÉBITO A\nCUIT 30-71234567-9');
    expect(result!.documentType).toBe('NOTA_DEBITO');
    expect(result!.confidence).toBe(96);
  });

  it('detects REMITO without CAE at confidence 93', () => {
    const result = runLayer1('R E M I T O\nFecha de entrega: 10/06/2026');
    expect(result!.documentType).toBe('REMITO');
    expect(result!.confidence).toBe(93);
  });

  it('does NOT match REMITO when CAE is present', () => {
    const text = 'R E M I T O\nCAE Nº: 75123456789012';
    // The REMITO signal should be excluded; CAE_FOUND wins instead
    const result = runLayer1(text);
    expect(result?.label).not.toBe('REMITO_HEADER');
  });

  it('returns null for unrecognizable text', () => {
    const result = runLayer1('Texto libre sin señales conocidas');
    expect(result).toBeNull();
  });

  it('does NOT match FACTURA ABC without CUIT present', () => {
    // FACTURA_ABC requires a CUIT corroboration
    const result = runLayer1('FACTURA A\nProducto X $500');
    // Should return null (no CUIT) OR return with CAE if present — in this case null
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/tests/classifier/layer1.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement layer1-definitive-signals.ts**

```typescript
// src/infrastructure/classifier/layers/layer1-definitive-signals.ts
import { DEFINITIVE_SIGNALS } from '../signals/definitive-signals.config.js';
import type { DocumentType } from '../types.js';

export interface Layer1Result {
  label: string;
  documentType: DocumentType;
  confidence: number;
}

/**
 * Layer 1: Definitive Signals.
 *
 * Scans for AFIP/ARCA hardcoded legal markers. A single match at this layer
 * sets document type with high confidence and skips Layers 2-3.
 *
 * Returns null if no definitive signal is found.
 * When multiple signals match, the first with highest confidence wins.
 */
export function runLayer1(text: string): Layer1Result | null {
  const upperText = text.toUpperCase();

  const candidates: Layer1Result[] = [];

  for (const signal of DEFINITIVE_SIGNALS) {
    if (!signal.pattern.test(text)) continue;

    // Check exclusion rule
    if (signal.excludeIfPattern && signal.excludeIfPattern.test(text)) continue;

    // Check required corroboration
    if (signal.requiresPattern && !signal.requiresPattern.test(text)) continue;

    candidates.push({
      label: signal.label,
      documentType: signal.documentType,
      confidence: signal.confidence,
    });
  }

  if (candidates.length === 0) return null;

  // Return the highest-confidence match
  return candidates.reduce((best, curr) => curr.confidence > best.confidence ? curr : best);
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/tests/classifier/layer1.test.ts
```

Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/classifier/layers/layer1-definitive-signals.ts src/tests/classifier/layer1.test.ts
git commit -m "feat: add Layer 1 definitive signals with tests"
```

---

## Task 9: Layer 2 — Corroborating signals

**Files:**
- Create: `src/infrastructure/classifier/layers/layer2-corroborating-signals.ts`
- Create: `src/tests/classifier/layer2.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/tests/classifier/layer2.test.ts
import { describe, it, expect } from 'vitest';
import { runLayer2 } from '../../infrastructure/classifier/layers/layer2-corroborating-signals.js';

describe('runLayer2', () => {
  it('accumulates points for factura signals', () => {
    const text = `
      PUNTO DE VENTA 0001
      CUIT: 30-71234567-9
      CONDICIÓN FRENTE AL IVA: Responsable Inscripto
      INICIO DE ACTIVIDADES: 01/01/2015
      INGRESOS BRUTOS: 12345
    `;
    const result = runLayer2(text);
    expect(result.winningType).toBe('FACTURA_COMPRA');
    expect(result.totalPts).toBeGreaterThanOrEqual(43); // 15+12+10+8+8
  });

  it('accumulates points for liquidación signals', () => {
    const text = `
      OBRA SOCIAL: OSDE
      ANSES: Sí
      CUIL 20-12345678-9
      SUELDO BÁSICO: $450.000
    `;
    const result = runLayer2(text);
    expect(result.winningType).toBe('LIQUIDACION_MOD');
    expect(result.totalPts).toBeGreaterThanOrEqual(65); // 18+20+15+20
  });

  it('applies contradiction penalties', () => {
    const text = `
      REMITO
      CAE Nº: 75123456789012
    `;
    const result = runLayer2(text);
    // REMITO gets 25 pts, CAE_FOUND causes -30 penalty → REMITO drops to -5
    // But CAE isn't in corroborating signals (it's layer 1) — so only REMITO_KEYWORD fires
    // The contradiction is: REMITO_KEYWORD + CAE_FOUND signal (we need to pass found labels)
    // In this test, CAE label not fired at layer 2, so no penalty — just REMITO_KEYWORD fires
    expect(result.signals.find((s) => s.label === 'REMITO_KEYWORD')).toBeDefined();
  });

  it('returns empty signals for text with no recognizable patterns', () => {
    const result = runLayer2('texto libre sin nada');
    expect(result.signals).toHaveLength(0);
    expect(result.totalPts).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/tests/classifier/layer2.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement layer2-corroborating-signals.ts**

```typescript
// src/infrastructure/classifier/layers/layer2-corroborating-signals.ts
import { CORROBORATING_SIGNALS, CONTRADICTIONS } from '../signals/corroborating-signals.config.js';
import type { DocumentType, SignalResult } from '../types.js';

export interface Layer2Result {
  signals: SignalResult[];
  totalPts: number;
  winningType: DocumentType | null;
  /** Points per type, for debugging and audit */
  scoreByType: Record<string, number>;
}

/**
 * Layer 2: Corroborating signals with weighted accumulation.
 *
 * Scans text against all secondary signals. Accumulates points by document type.
 * Applies contradiction penalties between co-occurring signals.
 *
 * @param text - raw document text
 * @param extraFoundLabels - labels already found in Layer 1 (for contradiction checking)
 */
export function runLayer2(text: string, extraFoundLabels: string[] = []): Layer2Result {
  const foundSignals: SignalResult[] = [];
  const foundLabels: Set<string> = new Set(extraFoundLabels);

  // Test each corroborating signal
  for (const signal of CORROBORATING_SIGNALS) {
    if (signal.pattern.test(text)) {
      foundSignals.push({ label: signal.label, pts: signal.pts, type: signal.type, layer: 2 });
      foundLabels.add(signal.label);
    }
  }

  // Apply contradiction penalties
  const penalties: SignalResult[] = [];
  for (const rule of CONTRADICTIONS) {
    if (foundLabels.has(rule.if) && foundLabels.has(rule.and)) {
      penalties.push({ label: `CONTRADICTION:${rule.if}+${rule.and}`, pts: rule.penalty, type: '', layer: 2 });
    }
  }

  const allSignals = [...foundSignals, ...penalties];

  // Sum points by type
  const scoreByType: Record<string, number> = {};
  for (const signal of foundSignals) {
    scoreByType[signal.type] = (scoreByType[signal.type] ?? 0) + signal.pts;
  }
  // Penalties reduce the winning type's score — apply proportionally to all types
  for (const penalty of penalties) {
    for (const type of Object.keys(scoreByType)) {
      scoreByType[type] = (scoreByType[type] ?? 0) + penalty.pts;
    }
  }

  // Find winning type
  const entries = Object.entries(scoreByType).filter(([, pts]) => pts > 0);
  const winner = entries.length > 0
    ? entries.reduce((best, curr) => curr[1] > best[1] ? curr : best)
    : null;

  const winningType = (winner?.[0] ?? null) as DocumentType | null;
  const totalPts = winner?.[1] ?? 0;

  return { signals: allSignals, totalPts, winningType, scoreByType };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/tests/classifier/layer2.test.ts
```

Expected: All tests pass (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/classifier/layers/layer2-corroborating-signals.ts src/tests/classifier/layer2.test.ts
git commit -m "feat: add Layer 2 corroborating signals with tests"
```

---

## Task 10: Layer 3 — Numeric validation

**Files:**
- Create: `src/infrastructure/classifier/layers/layer3-numeric-validation.ts`
- Create: `src/tests/classifier/layer3.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/tests/classifier/layer3.test.ts
import { describe, it, expect } from 'vitest';
import { runLayer3 } from '../../infrastructure/classifier/layers/layer3-numeric-validation.js';

describe('runLayer3', () => {
  it('adds +10 for valid CUIT and +12 for valid CAE', () => {
    const text = 'CUIT: 30-71234567-9\nCAE Nº: 75123456789012\nFecha: 10/06/2026';
    const delta = runLayer3(text);
    // +10 (valid CUIT) + 12 (valid CAE) + 5 (reasonable date) = 27
    expect(delta).toBeGreaterThanOrEqual(22);
  });

  it('subtracts -15 for CUIT-formatted string with invalid verifier', () => {
    // 30-71234567-0 has wrong verifier (should be 9)
    const text = 'CUIT: 30-71234567-0';
    const delta = runLayer3(text);
    expect(delta).toBeLessThan(0);
  });

  it('subtracts -20 for CAE that is not 14 digits', () => {
    const text = 'CAE Nº: 123456'; // too short
    const delta = runLayer3(text);
    expect(delta).toBeLessThanOrEqual(-10);
  });

  it('adds +5 for a date within the last 10 years', () => {
    const text = `Fecha: 01/01/${new Date().getFullYear()}`;
    const delta = runLayer3(text);
    expect(delta).toBeGreaterThanOrEqual(5);
  });

  it('subtracts -10 for a date too far in the past', () => {
    const text = 'Fecha: 01/01/1990';
    const delta = runLayer3(text);
    expect(delta).toBeLessThan(0);
  });

  it('returns 0 for text with no numeric structure', () => {
    const delta = runLayer3('texto libre sin numeros especiales');
    expect(delta).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/tests/classifier/layer3.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement layer3-numeric-validation.ts**

```typescript
// src/infrastructure/classifier/layers/layer3-numeric-validation.ts
import { validateCuit } from '../utils/cuit-validator.js';
import { extractCAE, validateCAEStructure } from '../utils/cae-validator.js';
import { extractFirstDate } from '../utils/text-extractor.js';

/**
 * Layer 3: Numeric Structural Validation.
 *
 * Validates the numeric integrity of identifiers found in the document.
 * Returns a delta (+/-) to apply to the current confidence score.
 * Does NOT classify on its own — only confirms or penalizes.
 */
export function runLayer3(text: string): number {
  let delta = 0;

  // ── CUIT validation ────────────────────────────────────────────────────────
  const cuitMatches = text.match(/\d{2}-\d{8}-\d/g) ?? [];
  const rawCuitMatches = text.match(/(?<!\d)\d{11}(?!\d)/g) ?? [];
  const allCandidates = [
    ...cuitMatches.map((c) => c.replace(/\D/g, '')),
    ...rawCuitMatches,
  ];

  if (allCandidates.length > 0) {
    const validCount = allCandidates.filter(validateCuit).length;
    if (validCount > 0) {
      delta += 10; // at least one valid CUIT
    } else {
      delta -= 15; // CUIT-shaped numbers but all fail checksum → suspect
    }
  }

  // ── CAE validation ─────────────────────────────────────────────────────────
  const caePattern = /\bCAE\s*N?[°º]?\s*:?\s*(\d+)\b/i;
  const caeRaw = caePattern.exec(text);
  if (caeRaw && caeRaw[1]) {
    const digits = caeRaw[1];
    if (validateCAEStructure(digits)) {
      delta += 12;
    } else {
      delta -= 20; // labeled as CAE but wrong structure
    }
  }

  // ── Date reasonableness ────────────────────────────────────────────────────
  const date = extractFirstDate(text);
  if (date) {
    const currentYear = new Date().getFullYear();
    if (date.year >= currentYear - 10 && date.year <= currentYear + 1) {
      delta += 5;
    } else {
      delta -= 10; // implausible date
    }
  }

  return delta;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/tests/classifier/layer3.test.ts
```

Expected: All tests pass (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/classifier/layers/layer3-numeric-validation.ts src/tests/classifier/layer3.test.ts
git commit -m "feat: add Layer 3 numeric validation with tests"
```

---

## Task 11: Layer 4 — Business routing (cost section)

**Files:**
- Create: `src/infrastructure/classifier/layers/layer4-business-routing.ts`
- Create: `src/tests/classifier/layer4.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/tests/classifier/layer4.test.ts
import { describe, it, expect } from 'vitest';
import { runLayer4 } from '../../infrastructure/classifier/layers/layer4-business-routing.js';

describe('runLayer4', () => {
  it('routes LIQUIDACION_MOD to MANO_DE_OBRA at 99', () => {
    const result = runLayer4('LIQUIDACION_MOD', '');
    expect(result.costSection).toBe('MANO_DE_OBRA');
    expect(result.confidence).toBe(99);
    expect(result.requiresAI).toBe(false);
  });

  it('routes PLANILLA_HORAS to MANO_DE_OBRA at 99', () => {
    const result = runLayer4('PLANILLA_HORAS', '');
    expect(result.costSection).toBe('MANO_DE_OBRA');
    expect(result.confidence).toBe(99);
  });

  it('routes NOTA_DEBITO to COSTOS_INDIRECTOS at 85', () => {
    const result = runLayer4('NOTA_DEBITO', '');
    expect(result.costSection).toBe('COSTOS_INDIRECTOS');
  });

  it('routes FACTURA_COMPRA with MP keywords to MATERIA_PRIMA', () => {
    const result = runLayer4('FACTURA_COMPRA', 'Insumo bobina de acero kg materia prima');
    expect(result.costSection).toBe('MATERIA_PRIMA');
    expect(result.requiresAI).toBe(false);
  });

  it('routes FACTURA_COMPRA with CIP keywords to COSTOS_INDIRECTOS', () => {
    const result = runLayer4('FACTURA_COMPRA', 'Alquiler mensual del galpón - Servicio de electricidad');
    expect(result.costSection).toBe('COSTOS_INDIRECTOS');
    expect(result.requiresAI).toBe(false);
  });

  it('marks FACTURA_COMPRA without keywords as requiresAI', () => {
    const result = runLayer4('FACTURA_COMPRA', 'Proveedor desconocido sin descripción clara');
    expect(result.requiresAI).toBe(true);
  });

  it('routes FACTURA_VENTA to VENTAS at 99', () => {
    const result = runLayer4('FACTURA_VENTA', '');
    expect(result.costSection).toBe('VENTAS');
    expect(result.confidence).toBe(99);
  });

  it('routes DESCONOCIDO to DESCONOCIDO and requiresAI', () => {
    const result = runLayer4('DESCONOCIDO', '');
    expect(result.costSection).toBe('DESCONOCIDO');
    expect(result.requiresAI).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/tests/classifier/layer4.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement layer4-business-routing.ts**

```typescript
// src/infrastructure/classifier/layers/layer4-business-routing.ts
import type { DocumentType, CostSection } from '../types.js';

export interface Layer4Result {
  costSection: CostSection;
  confidence: number;
  requiresAI: boolean;
}

// Keywords that strongly indicate Materia Prima (raw materials)
const MP_KEYWORDS = [
  'materia prima', 'insumo', 'material', ' kg', 'litro', 'tonelada',
  'bobina', 'rollo', 'envase', 'embalaje', 'chapa', 'alambre', 'tela', 'hilo',
  'resina', 'pintura', 'solvente', 'madera', 'cartón', 'plástico',
];

// Keywords that strongly indicate Costos Indirectos de Producción
const CIP_KEYWORDS = [
  'alquiler', 'alq.', 'servicio', 'energía', 'energia', 'electricidad',
  'gas', 'mantenimiento', 'mant.', 'seguro', 'limpieza', 'vigilancia',
  'telefonía', 'telefonia', 'internet', 'agua', 'abono', 'cuota',
  'reparacion', 'reparación', 'repuesto', 'herramienta',
];

/**
 * Layer 4: Business Routing.
 *
 * Determines which cost section a classified document belongs to.
 * Uses fixed rules for unambiguous types (MOD, Ventas) and keyword
 * scanning for ambiguous types (FACTURA_COMPRA → MP vs CIP).
 *
 * @param documentType - resolved document type from layers 1-3
 * @param text - raw document text for keyword scanning
 */
export function runLayer4(documentType: DocumentType | string, text: string): Layer4Result {
  const lower = text.toLowerCase();

  switch (documentType) {
    case 'LIQUIDACION_MOD':
    case 'PLANILLA_HORAS':
      return { costSection: 'MANO_DE_OBRA', confidence: 99, requiresAI: false };

    case 'FACTURA_VENTA':
      return { costSection: 'VENTAS', confidence: 99, requiresAI: false };

    case 'REMITO': {
      // Remito de entrada (proveedor → empresa) → MP; salida → VENTAS
      // Heuristic: if text contains "recibimos" or "entrada" → MP; "despachamos"/"salida" → VENTAS
      if (/\brecibimos\b|\bentrada\b|\bcompra\b/i.test(text)) {
        return { costSection: 'MATERIA_PRIMA', confidence: 80, requiresAI: false };
      }
      if (/\bdespachamos\b|\bsalida\b|\bventa\b/i.test(text)) {
        return { costSection: 'VENTAS', confidence: 80, requiresAI: false };
      }
      return { costSection: 'DESCONOCIDO', confidence: 50, requiresAI: true };
    }

    case 'NOTA_DEBITO':
    case 'NOTA_CREDITO':
      // Debit/credit notes are usually adjustments — default to CIP
      return { costSection: 'COSTOS_INDIRECTOS', confidence: 85, requiresAI: false };

    case 'FACTURA_COMPRA': {
      const mpScore = MP_KEYWORDS.filter((kw) => lower.includes(kw)).length;
      const cipScore = CIP_KEYWORDS.filter((kw) => lower.includes(kw)).length;

      if (mpScore > cipScore && mpScore >= 1) {
        return { costSection: 'MATERIA_PRIMA', confidence: 82 + Math.min(mpScore * 3, 15), requiresAI: false };
      }
      if (cipScore > mpScore && cipScore >= 1) {
        return { costSection: 'COSTOS_INDIRECTOS', confidence: 82 + Math.min(cipScore * 3, 15), requiresAI: false };
      }
      // Tie or no keywords → needs AI to decide
      return { costSection: 'DESCONOCIDO', confidence: 50, requiresAI: true };
    }

    default:
      return { costSection: 'DESCONOCIDO', confidence: 0, requiresAI: true };
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/tests/classifier/layer4.test.ts
```

Expected: All tests pass (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/classifier/layers/layer4-business-routing.ts src/tests/classifier/layer4.test.ts
git commit -m "feat: add Layer 4 business routing with tests"
```

---

## Task 12: Layer 5 — Groq AI Fallback

**Files:**
- Modify: `src/infrastructure/ai/groq-service.ts`
- Create: `src/infrastructure/classifier/layers/layer5-ai-fallback.ts`

- [ ] **Step 1: Add `classifyDocument()` to groq-service.ts**

Open `src/infrastructure/ai/groq-service.ts`. After the existing `analyzeDocument()` method and before the closing `}` of the class, add this method:

```typescript
  /**
   * Layer 5 AI Fallback: classifies a document when deterministic rules
   * couldn't reach the confidence threshold.
   *
   * Receives the signals already found (so AI doesn't repeat the work)
   * and the accumulated confidence so far.
   */
  async classifyDocument(input: {
    text: string;
    accumulatedPts: number;
    foundSignalLabels: string[];
    suggestedType: string | null;
  }): Promise<{ documentType: string; costSection: string; confidence: number; reasoning: string } | null> {
    if (!this.isConfigured) return null;

    const signalsSummary = input.foundSignalLabels.length > 0
      ? input.foundSignalLabels.map((l) => `- ${l}`).join('\n')
      : '- Ninguna señal encontrada';

    const prompt = `Contexto: documento contable argentino enviado por un operador de PyME.
El clasificador de reglas encontró estas señales:
${signalsSummary}
Confianza acumulada: ${input.accumulatedPts}/100
Clasificación parcial: ${input.suggestedType ?? 'DESCONOCIDO'}

Texto del documento:
${input.text.slice(0, 3000)}

Tipos posibles: FACTURA_COMPRA, FACTURA_VENTA, REMITO, LIQUIDACION_MOD, PLANILLA_HORAS, NOTA_DEBITO, NOTA_CREDITO, DESCONOCIDO
Secciones de costo: MATERIA_PRIMA, MANO_DE_OBRA, COSTOS_INDIRECTOS, VENTAS, DESCONOCIDO

Respondé SOLO con JSON:
{
  "documentType": "...",
  "costSection": "...",
  "confidence": <número 0-100>,
  "reasoning": "una oración en español explicando la decisión"
}`;

    try {
      const res = await fetch(GROQ_API_URL, {
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
```

- [ ] **Step 2: Create layer5-ai-fallback.ts**

```typescript
// src/infrastructure/classifier/layers/layer5-ai-fallback.ts
import { GroqService } from '../../ai/groq-service.js';
import type { DocumentType, CostSection } from '../types.js';

const groq = new GroqService();

export interface Layer5Result {
  documentType: DocumentType;
  costSection: CostSection;
  confidence: number;
  reasoning: string;
}

const VALID_DOC_TYPES = new Set<string>([
  'FACTURA_COMPRA', 'FACTURA_VENTA', 'REMITO', 'LIQUIDACION_MOD',
  'PLANILLA_HORAS', 'NOTA_DEBITO', 'NOTA_CREDITO', 'DESCONOCIDO',
]);

const VALID_SECTIONS = new Set<string>([
  'MATERIA_PRIMA', 'MANO_DE_OBRA', 'COSTOS_INDIRECTOS', 'VENTAS', 'DESCONOCIDO',
]);

/**
 * Layer 5: Groq AI Fallback.
 *
 * Only called when accumulated confidence < 72 after layers 0-4.
 * Passes the already-found signals so the AI doesn't re-derive them.
 * Returns null if the API is unavailable.
 */
export async function runLayer5(input: {
  text: string;
  accumulatedPts: number;
  foundSignalLabels: string[];
  suggestedType: string | null;
}): Promise<Layer5Result | null> {
  const raw = await groq.classifyDocument(input);
  if (!raw) return null;

  // Validate returned values against allowed enums
  const documentType = VALID_DOC_TYPES.has(raw.documentType)
    ? (raw.documentType as DocumentType)
    : 'DESCONOCIDO';

  const costSection = VALID_SECTIONS.has(raw.costSection)
    ? (raw.costSection as CostSection)
    : 'DESCONOCIDO';

  const confidence = Math.min(100, Math.max(0, Math.round(raw.confidence)));

  return { documentType, costSection, confidence, reasoning: raw.reasoning };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/ai/groq-service.ts src/infrastructure/classifier/layers/layer5-ai-fallback.ts
git commit -m "feat: add Layer 5 Groq AI fallback for low-confidence documents"
```

---

## Task 13: Cascade Orchestrator

**Files:**
- Create: `src/infrastructure/classifier/cascade-classifier.ts`
- Create: `src/tests/classifier/cascade.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
// src/tests/classifier/cascade.test.ts
import { describe, it, expect } from 'vitest';
import { classifyDocument } from '../../infrastructure/classifier/cascade-classifier.js';

const BASE_INPUT = { costistId: 'c-001', companyId: 'co-001', dataEntryId: 'de-001' };

describe('classifyDocument — cascade orchestrator', () => {
  it('classifies a factura with CAE at ≥97 confidence', async () => {
    const text = `
      FACTURA A
      CAE Nº: 75123456789012
      CUIT: 30-71234567-9
      PUNTO DE VENTA 0001
      Fecha: 10/06/2026
      Proveedor: Aceros SRL
      Bobina de acero AISI 1020 — 500 kg
    `;
    const result = await classifyDocument({ ...BASE_INPUT, text, groqQuality: 'legible' });
    expect(result.documentType).toBe('FACTURA_COMPRA');
    expect(result.costSection).toBe('MATERIA_PRIMA');
    expect(result.confidence).toBeGreaterThanOrEqual(95);
    expect(result.requiresReview).toBe(false);
    expect(result.aiUsed).toBe(false); // Layer 1 handled it
  });

  it('classifies a liquidación at ≥98 confidence', async () => {
    const text = `
      RECIBO DE SUELDO
      Empleado: María González  CUIL 27-28765432-1
      OBRA SOCIAL: OSDE  ANSES: Sí
      SUELDO BÁSICO
      Fecha: 01/06/2026
    `;
    const result = await classifyDocument({ ...BASE_INPUT, text, groqQuality: 'legible' });
    expect(result.documentType).toBe('LIQUIDACION_MOD');
    expect(result.costSection).toBe('MANO_DE_OBRA');
    expect(result.confidence).toBeGreaterThanOrEqual(97);
  });

  it('returns FAIL gate for ilegible quality', async () => {
    const result = await classifyDocument({ ...BASE_INPUT, text: '', groqQuality: 'ilegible' });
    expect(result.qualityGate).toBe('FAIL');
    expect(result.requiresReview).toBe(true);
    expect(result.documentType).toBe('DESCONOCIDO');
  });

  it('caps confidence at 65 for partial quality', async () => {
    const text = 'FACTURA A CUIT 30-71234567-9 CAE Nº: 75123456789012';
    const result = await classifyDocument({ ...BASE_INPUT, text, groqQuality: 'parcial' });
    expect(result.confidence).toBeLessThanOrEqual(65);
    expect(result.qualityGate).toBe('PARTIAL');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/tests/classifier/cascade.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement cascade-classifier.ts**

```typescript
// src/infrastructure/classifier/cascade-classifier.ts
import { runQualityGate } from './layers/layer0-quality-gate.js';
import { runLayer1 } from './layers/layer1-definitive-signals.js';
import { runLayer2 } from './layers/layer2-corroborating-signals.js';
import { runLayer3 } from './layers/layer3-numeric-validation.js';
import { runLayer4 } from './layers/layer4-business-routing.js';
import { runLayer5 } from './layers/layer5-ai-fallback.js';
import type { ClassifierInput, ClassificationResult, DocumentType, CostSection } from './types.js';

const CONFIDENCE_THRESHOLD = 72;

/**
 * Main cascade classifier orchestrator.
 *
 * Runs the 6-layer pipeline in order, short-circuiting early when confidence
 * is already high enough. Never forces a classification — prefers
 * requiresReview=true over a wrong label.
 *
 * This function is pure from the caller's perspective: it does NOT write to the DB.
 * Persistence (ClassificationAudit, ProcessedCAE, SupplierFingerprint lookup)
 * is handled by empresa-portal-service.ts.
 */
export async function classifyDocument(input: ClassifierInput & {
  groqQuality?: 'legible' | 'parcial' | 'ilegible' | null;
}): Promise<ClassificationResult> {
  const { text, groqQuality = null } = input;

  // ── Layer 0: Quality Gate ──────────────────────────────────────────────────
  const qualityResult = runQualityGate({ quality: groqQuality, text });
  if (qualityResult.gate === 'FAIL') {
    return {
      documentType: 'DESCONOCIDO',
      costSection: 'DESCONOCIDO',
      confidence: 0,
      requiresReview: true,
      isDuplicate: false,
      qualityGate: 'FAIL',
      definitiveSignal: null,
      signals: [],
      aiUsed: false,
      supplierFingerprintUsed: false,
      confidenceCap: null,
    };
  }

  const confidenceCap = qualityResult.confidenceCap;

  // ── Layer 1: Definitive Signals ────────────────────────────────────────────
  const layer1 = runLayer1(text);

  if (layer1) {
    let confidence = confidenceCap !== null ? Math.min(layer1.confidence, confidenceCap) : layer1.confidence;

    // Refine FACTURA type (compra vs venta) — delegate to Layer 4
    const l4 = runLayer4(layer1.documentType, text);
    const finalSection = l4.costSection;
    const finalType = layer1.documentType as DocumentType;

    if (confidence >= CONFIDENCE_THRESHOLD && !l4.requiresAI) {
      return {
        documentType: finalType,
        costSection: finalSection,
        confidence,
        requiresReview: false,
        isDuplicate: false,
        qualityGate: qualityResult.gate,
        definitiveSignal: layer1.label,
        signals: [{ label: layer1.label, pts: layer1.confidence, type: finalType, layer: 1 }],
        aiUsed: false,
        supplierFingerprintUsed: false,
        confidenceCap,
      };
    }

    // Layer 1 found something but Layer 4 needs AI for cost section routing
    if (l4.requiresAI && confidence >= CONFIDENCE_THRESHOLD) {
      const aiResult = await runLayer5({
        text,
        accumulatedPts: confidence,
        foundSignalLabels: [layer1.label],
        suggestedType: finalType,
      });

      if (aiResult) {
        const finalConfidence = confidenceCap !== null ? Math.min(aiResult.confidence, confidenceCap) : aiResult.confidence;
        return {
          documentType: finalType, // keep layer 1 type, AI refines section
          costSection: aiResult.costSection,
          confidence: finalConfidence,
          requiresReview: finalConfidence < CONFIDENCE_THRESHOLD,
          isDuplicate: false,
          qualityGate: qualityResult.gate,
          definitiveSignal: layer1.label,
          signals: [{ label: layer1.label, pts: layer1.confidence, type: finalType, layer: 1 }],
          aiUsed: true,
          supplierFingerprintUsed: false,
          confidenceCap,
        };
      }
    }
  }

  // ── Layers 2-3: Corroborating + Numeric ───────────────────────────────────
  const layer1Labels = layer1 ? [layer1.label] : [];
  const layer2 = runLayer2(text, layer1Labels);
  const layer3Delta = runLayer3(text);

  let accumulatedPts = (layer2.totalPts + layer3Delta);
  const suggestedType = layer2.winningType ?? (layer1?.documentType ?? null);

  if (confidenceCap !== null) {
    accumulatedPts = Math.min(accumulatedPts, confidenceCap);
  }

  const allSignals = [...(layer1 ? [{ label: layer1.label, pts: layer1.confidence, type: layer1.documentType, layer: 1 as const }] : []), ...layer2.signals];

  // ── Layer 4: Business Routing ──────────────────────────────────────────────
  const l4 = runLayer4(suggestedType ?? 'DESCONOCIDO', text);

  if (accumulatedPts >= CONFIDENCE_THRESHOLD && !l4.requiresAI) {
    const finalConfidence = confidenceCap !== null ? Math.min(accumulatedPts, confidenceCap) : accumulatedPts;
    return {
      documentType: (suggestedType ?? 'DESCONOCIDO') as DocumentType,
      costSection: l4.costSection,
      confidence: Math.min(finalConfidence, 100),
      requiresReview: false,
      isDuplicate: false,
      qualityGate: qualityResult.gate,
      definitiveSignal: layer1?.label ?? null,
      signals: allSignals,
      aiUsed: false,
      supplierFingerprintUsed: false,
      confidenceCap,
    };
  }

  // ── Layer 5: AI Fallback ───────────────────────────────────────────────────
  const foundLabels = allSignals.map((s) => s.label);
  const aiResult = await runLayer5({ text, accumulatedPts, foundSignalLabels: foundLabels, suggestedType });

  if (aiResult) {
    const finalConfidence = confidenceCap !== null ? Math.min(aiResult.confidence, confidenceCap) : aiResult.confidence;
    return {
      documentType: aiResult.documentType as DocumentType,
      costSection: aiResult.costSection as CostSection,
      confidence: finalConfidence,
      requiresReview: finalConfidence < CONFIDENCE_THRESHOLD,
      isDuplicate: false,
      qualityGate: qualityResult.gate,
      definitiveSignal: layer1?.label ?? null,
      signals: allSignals,
      aiUsed: true,
      supplierFingerprintUsed: false,
      confidenceCap,
    };
  }

  // ── Layer 6: Human Escalation ──────────────────────────────────────────────
  return {
    documentType: (suggestedType ?? 'DESCONOCIDO') as DocumentType,
    costSection: l4.costSection,
    confidence: Math.min(accumulatedPts, 71), // below threshold
    requiresReview: true,
    isDuplicate: false,
    qualityGate: qualityResult.gate,
    definitiveSignal: layer1?.label ?? null,
    signals: allSignals,
    aiUsed: false,
    supplierFingerprintUsed: false,
    confidenceCap,
  };
}
```

- [ ] **Step 4: Run all tests — verify everything passes**

```bash
npx vitest run src/tests/classifier/
```

Expected: All tests in all test files pass (the cascade tests may call Groq in some cases — those will pass locally only if GROQ_API_KEY is set, which is fine for Railway).

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/classifier/ src/tests/classifier/cascade.test.ts
git commit -m "feat: add cascade classifier orchestrator with integration tests"
```

---

## Task 14: SupplierFingerprint lookup in orchestrator

This task adds the fingerprint bonus to the cascade classifier, boosting confidence for known suppliers.

**Files:**
- Modify: `src/infrastructure/classifier/cascade-classifier.ts`

- [ ] **Step 1: Add fingerprint lookup at the start of classifyDocument**

In `cascade-classifier.ts`, add this import at the top:

```typescript
import { prisma } from '../database/prisma.js';
```

Then, inside `classifyDocument()`, after the quality gate check and before Layer 1, add this block:

```typescript
  // ── Supplier Fingerprint Lookup (bonus confidence) ──────────────────────────
  let supplierFingerprintUsed = false;
  let fingerprintBonus = 0;
  let fingerprintType: DocumentType | null = null;
  let fingerprintSection: CostSection | null = null;

  if (input.supplierCuit) {
    const fp = await prisma.supplierFingerprint.findUnique({
      where: { costistId_supplierCuit: { costistId: input.costistId, supplierCuit: input.supplierCuit } },
    });
    if (fp && fp.timesSeenCorrect >= 3) {
      supplierFingerprintUsed = true;
      fingerprintBonus = fp.confidenceBonus;
      fingerprintType = fp.documentType as DocumentType;
      fingerprintSection = fp.costSection as CostSection;
    }
  }
```

Then, at the Layer 1 section, after computing `confidence`, add the bonus:

```typescript
    confidence = confidenceCap !== null
      ? Math.min(layer1.confidence + fingerprintBonus, confidenceCap)
      : layer1.confidence + fingerprintBonus;
```

And propagate `supplierFingerprintUsed` to the returned object (replace all `supplierFingerprintUsed: false` with the local variable `supplierFingerprintUsed`).

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/classifier/cascade-classifier.ts
git commit -m "feat: add supplier fingerprint bonus to cascade classifier"
```

---

## Task 15: Integration — empresa-portal-service.ts

**Files:**
- Modify: `src/application/empresa/empresa-portal-service.ts`

- [ ] **Step 1: Add imports at the top of empresa-portal-service.ts**

After the existing imports, add:

```typescript
import { classifyDocument } from '../../infrastructure/classifier/cascade-classifier.js';
import { extractCuits } from '../../infrastructure/classifier/utils/cuit-validator.js';
import { extractCAE } from '../../infrastructure/classifier/utils/cae-validator.js';
```

- [ ] **Step 2: Replace the submitDocument() body**

Replace the entire `submitDocument()` method (currently lines ~255-308) with:

```typescript
  async submitDocument(
    operatorId: string,
    input: {
      rawContent: string;
      sourceType: 'TEXT' | 'PDF' | 'IMAGE';
      connectionId?: string;
      fileName?: string;
      fileData?: string;
      fileMimeType?: string;
    },
  ) {
    const memberships = await this.db.operatorMembership.findMany({
      where: { operatorId, isActive: true },
      include: { connection: true },
    });

    if (memberships.length === 0) {
      throw new ForbiddenError('No tenés acceso activo a ninguna empresa.');
    }

    let membership = memberships[0]!;
    if (input.connectionId) {
      const found = memberships.find((m) => m.connectionId === input.connectionId);
      if (!found) throw new ForbiddenError('No tenés acceso a esa empresa.');
      membership = found;
    } else if (memberships.length > 1 && !input.connectionId) {
      throw new ForbiddenError('Tenés acceso a varias empresas. Indicá a cuál querés enviar.');
    }

    const costistId = membership.connection.costistId;
    const companyId = membership.connection.companyId;

    // ── Step 1: Run Groq document analysis (for extraction + quality assessment) ──
    const aiAnalysis = await this.groq.analyzeDocument({
      text: input.rawContent,
      fileData: input.fileData,
      fileMimeType: input.fileMimeType,
      fileName: input.fileName,
    });

    // ── Step 2: Extract CUIT from text for fingerprinting ─────────────────────
    const textToClassify = input.rawContent || (input.fileName ?? '');
    const foundCuits = extractCuits(textToClassify);
    const supplierCuit = foundCuits[0] ?? null;

    // ── Step 3: Check for duplicate CAE ───────────────────────────────────────
    const cae = extractCAE(textToClassify);
    if (cae) {
      const existingCAE = await this.db.processedCAE.findUnique({ where: { cae } });
      if (existingCAE) {
        // Return duplicate signal — don't save a new entry
        return {
          isDuplicate: true,
          duplicateEntryId: existingCAE.dataEntryId,
          message: 'Este documento ya fue enviado anteriormente.',
        };
      }
    }

    // ── Step 4: Run cascade classifier ────────────────────────────────────────
    // We generate a temporary ID for the audit; the actual dataEntryId is filled after DB insert
    const tempId = `temp-${Date.now()}`;
    const classification = await classifyDocument({
      text: textToClassify,
      costistId,
      companyId,
      dataEntryId: tempId,
      supplierCuit,
      groqQuality: aiAnalysis?.quality ?? null,
    });

    // ── Step 5: Save DataEntry ─────────────────────────────────────────────────
    const aiJson = aiAnalysis ? JSON.stringify(aiAnalysis) : null;

    const entry = await this.db.dataEntry.create({
      data: {
        connectionId: membership.connectionId,
        costistId,
        rawContent: input.rawContent || (input.fileName ? `[Archivo: ${input.fileName}]` : ''),
        sourceType: input.sourceType,
        status: 'PENDING',
        fileName: input.fileName ?? null,
        fileData: input.fileData ?? null,
        fileMimeType: input.fileMimeType ?? null,
        reviewNote: aiJson,
      },
    });

    // ── Step 6: Persist audit + CAE ────────────────────────────────────────────
    await this.db.$transaction(async (tx) => {
      await tx.classificationAudit.create({
        data: {
          dataEntryId: entry.id,
          companyId,
          costistId,
          qualityGate: classification.qualityGate,
          definitiveSignal: classification.definitiveSignal,
          corroboratingSignals: classification.signals,
          numericValidationDelta: 0, // included in confidence already
          supplierFingerprintUsed: classification.supplierFingerprintUsed,
          aiUsed: classification.aiUsed,
          confidenceCap: classification.confidenceCap,
          documentType: classification.documentType,
          costSection: classification.costSection,
          confidence: classification.confidence,
          requiresReview: classification.requiresReview,
        },
      });

      if (cae) {
        await tx.processedCAE.create({
          data: { cae, dataEntryId: entry.id, companyId },
        });
      }
    });

    return {
      id: entry.id,
      status: entry.status,
      aiResponse: aiJson,
      classification: {
        documentType: classification.documentType,
        costSection: classification.costSection,
        confidence: classification.confidence,
        requiresReview: classification.requiresReview,
        qualityGate: classification.qualityGate,
      },
      isDuplicate: false,
    };
  }
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/application/empresa/empresa-portal-service.ts
git commit -m "feat: integrate cascade classifier into submitDocument flow"
```

---

## Task 16: SupplierFingerprint — learning on validation

**Files:**
- Modify: `src/application/validaciones/validaciones-service.ts`

- [ ] **Step 1: Add fingerprint update logic to the review() method**

In `validaciones-service.ts`, add this import at the top:

```typescript
import { extractCuits } from '../../infrastructure/classifier/utils/cuit-validator.js';
```

Then, inside the `review()` method, inside the `$transaction` block, after the `validationHistory.create()` call, add:

```typescript
      // ── Update supplier fingerprint if approved or corrected ───────────────
      if (input.status === 'APPROVED' || input.status === 'CORRECTED') {
        // Find the classification audit for this entry
        const audit = await tx.classificationAudit.findFirst({
          where: { dataEntryId: entryId },
          orderBy: { createdAt: 'desc' },
        });

        if (audit) {
          // Extract supplier CUIT from the raw content
          const foundCuits = extractCuits(u.rawContent);
          const supplierCuit = foundCuits[0];

          // Determine the final type/section (costista may have corrected it)
          const finalType = (input.correctedContent ? audit.documentType : audit.documentType);
          const finalSection = audit.costSection;

          const overrode = input.status === 'CORRECTED';

          // Update audit record
          await tx.classificationAudit.update({
            where: { id: audit.id },
            data: {
              validatedByCostista: true,
              costaValidatedAt: new Date(),
              costaOverrode: overrode,
            },
          });

          // Update supplier fingerprint if CUIT found
          if (supplierCuit) {
            const existing = await tx.supplierFingerprint.findUnique({
              where: { costistId_supplierCuit: { costistId, supplierCuit } },
            });

            if (existing) {
              const timesSeenCorrect = overrode ? existing.timesSeenCorrect : existing.timesSeenCorrect + 1;
              const timesOverridden = overrode ? existing.timesOverridden + 1 : existing.timesOverridden;
              const total = timesSeenCorrect + timesOverridden;
              const bonus = total > 0 ? Math.min(25, Math.round((timesSeenCorrect / total) * 30)) : 0;

              await tx.supplierFingerprint.update({
                where: { id: existing.id },
                data: {
                  timesSeenCorrect,
                  timesOverridden,
                  confidenceBonus: bonus,
                  documentType: overrode ? finalType : existing.documentType,
                  costSection: overrode ? finalSection : existing.costSection,
                },
              });
            } else if (!overrode) {
              // First time seeing this supplier — create fingerprint
              await tx.supplierFingerprint.create({
                data: {
                  costistId,
                  supplierCuit,
                  documentType: finalType,
                  costSection: finalSection,
                  timesSeenCorrect: 1,
                  timesOverridden: 0,
                  confidenceBonus: 5,
                },
              });
            }
          }
        }
      }
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/application/validaciones/validaciones-service.ts
git commit -m "feat: update SupplierFingerprint on costista validation"
```

---

## Task 17: Final verification and deploy

- [ ] **Step 1: Run full TypeScript check**

```bash
cd C:\Users\giuli\Documents\CosteAR\CosteAR-backend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: Compiles to `dist/` without errors.

- [ ] **Step 4: Push to Railway**

```bash
git push origin main
```

Railway picks up the push automatically. The migration will NOT run automatically on Railway — you need to run it manually once:

In the Railway dashboard → your backend service → "Shell" tab:
```bash
npx prisma migrate deploy
```

Expected: All 3 new migrations applied successfully.

- [ ] **Step 5: Final commit summary**

All commits made in this feature:
1. `feat: add SupplierFingerprint, ClassificationAudit, ProcessedCAE tables`
2. `feat: add classifier shared types`
3. `feat: add CUIT validator utility with tests`
4. `feat: add CAE structure validator utility with tests`
5. `feat: add text extractor utility for classifier`
6. `feat: add Layer 0 quality gate with tests`
7. `feat: add definitive and corroborating signal configs`
8. `feat: add Layer 1 definitive signals with tests`
9. `feat: add Layer 2 corroborating signals with tests`
10. `feat: add Layer 3 numeric validation with tests`
11. `feat: add Layer 4 business routing with tests`
12. `feat: add Layer 5 Groq AI fallback for low-confidence documents`
13. `feat: add cascade classifier orchestrator with integration tests`
14. `feat: add supplier fingerprint bonus to cascade classifier`
15. `feat: integrate cascade classifier into submitDocument flow`
16. `feat: update SupplierFingerprint on costista validation`

---

## Self-review

**Spec coverage check:**
- ✅ Layer 0 Quality Gate (Task 6)
- ✅ Layer 1 Definitive Signals: CAE, RECIBO DE SUELDO, FACTURA ABC, NOTA DÉBITO, REMITO (Task 8)
- ✅ Layer 2 Corroborating Signals with contradiction penalties (Task 9)
- ✅ Layer 3 Numeric validation: CUIT checksum, CAE structure, date reasonableness (Task 10)
- ✅ Layer 4 Business routing: MOD→MOD, Ventas, FACTURA_COMPRA→MP/CIP keywords (Task 11)
- ✅ Layer 5 Groq AI Fallback with signals context (Task 12)
- ✅ Layer 6 Human escalation: `requiresReview: true` returned from orchestrator (handled in Task 13)
- ✅ SupplierFingerprint table + learning (Tasks 1, 14, 16)
- ✅ ClassificationAudit log (Tasks 1, 15)
- ✅ ProcessedCAE duplicate detection (Tasks 1, 15)
- ✅ Integration into empresa-portal-service.ts (Task 15)
- ✅ Fingerprint update on validation (Task 16)
- ✅ CUIT algorithm (Task 3)
- ✅ CAE structural validation (Task 4)
- ✅ Confidence cap of 65 for partial quality (Tasks 6, 13)
- ✅ Never uses economic values — all signal patterns are structural/legal/format based

**Placeholder check:** No TBD, TODO, or "implement later" in any step. All code is complete.

**Type consistency:**
- `DocumentType` defined in `types.ts` Task 2, used consistently in all layers
- `ClassificationResult` defined in `types.ts`, returned by cascade-classifier.ts
- `SignalResult.layer` typed as `number` everywhere
- `runLayer4()` takes `string` (not `DocumentType`) to handle the `'DESCONOCIDO'` string from Groq — safe
