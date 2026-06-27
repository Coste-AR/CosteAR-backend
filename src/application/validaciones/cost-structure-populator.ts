// src/application/validaciones/cost-structure-populator.ts
//
// Cuando el costista aprueba un DataEntry, este módulo toma los datos extraídos
// por la IA (reviewNote) y los inserta/mergea en la CostStructure activa de la
// empresa según la sección (MATERIA_PRIMA, MANO_DE_OBRA, COSTOS_INDIRECTOS).
//
// Principio: NUNCA pisa datos ya ingresados por el costista manualmente.
// Solo AGREGA movimientos o registros nuevos con un tag "from_document".

import type { PrismaClient } from '@prisma/client';

// ─── Tipos extraídos de la IA ─────────────────────────────────────────────────

interface AiItem {
  description: string;
  quantity?: number | null;
  unitCost?: number | null;
  total?: number | null;
}

interface AiExtractedData {
  date?: string | null;
  supplier?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  netAmount?: number | null;
  currency?: string | null;
  items?: AiItem[] | null;
  department?: string | null;
  hoursWorked?: number | null;
  employeeCount?: number | null;
}

interface AiReviewNote {
  extractedData?: AiExtractedData | null;
  documentType?: string;
  costSection?: string;
  message?: string;
}

// ─── Tipos de las configs de CostStructure (espejo de cost-structure-types.ts) ─

interface Movement {
  date: string;
  type: 'purchase' | 'consumption';
  detail: string;
  quantity: number;
  unitCost: number;
  fromDocument?: boolean; // tag de trazabilidad
}

interface RawMaterialConfig {
  wilson?: {
    annualDemand?: number;
    orderCost?: number;
    holdingRate?: number;
    unitCost?: number;
  };
  stockPolicy?: {
    minConsumption?: number;
    maxConsumption?: number;
    minLeadTime?: number;
    maxLeadTime?: number;
    safetyStock?: number;
  };
  initialStock?: { quantity?: number; unitCost?: number };
  movements?: Movement[];
}

interface Department {
  name: string;
  basicRemuneration: number;
  hoursWorked: number;
  fromDocument?: boolean;
}

interface DirectLaborConfig {
  workingDays?: {
    totalDaysPerYear?: number;
    unpaidAbsence?: Record<string, number>;
    paidAbsence?: Record<string, number>;
  };
  itcs?: {
    derivationBase?: number;
    fixedArt?: number;
    uncertainRemunerative?: { name: string; coefficient: number }[];
    uncertainNonRemunerative?: { name: string; coefficient: number }[];
  };
  departments?: Department[];
}

interface CifConcept {
  name: string;
  amount: { fixed: number; variable: number };
  distribution: Record<string, number>;
  fromDocument?: boolean;
}

interface IndirectCostConfig {
  centers?: { id: string; name: string; type: 'productive' | 'service' }[];
  concepts?: CifConcept[];
  serviceDistributions?: unknown[];
  productiveSettings?: unknown[];
}

// ─── Parser del reviewNote ────────────────────────────────────────────────────

function parseReviewNote(raw: string | null): AiReviewNote | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as AiReviewNote;
    return null;
  } catch {
    return null;
  }
}

function formatDate(raw?: string | null): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

// ─── Populadores por sección ──────────────────────────────────────────────────

/**
 * MATERIA_PRIMA: agrega cada ítem del documento como un movimiento de compra
 * en la ficha PPP de la estructura. No pisa movimientos previos.
 */
function populateRawMaterial(current: RawMaterialConfig | null, ai: AiExtractedData): RawMaterialConfig {
  const cfg: RawMaterialConfig = current ? JSON.parse(JSON.stringify(current)) : {
    wilson: { annualDemand: 0, orderCost: 0, holdingRate: 0.3, unitCost: 0 },
    stockPolicy: { minConsumption: 0, maxConsumption: 0, minLeadTime: 0, maxLeadTime: 0, safetyStock: 0 },
    initialStock: { quantity: 0, unitCost: 0 },
    movements: [],
  };

  if (!Array.isArray(cfg.movements)) cfg.movements = [];

  const docDate = formatDate(ai.date);
  const supplier = ai.supplier?.trim() ?? 'Proveedor s/d';

  if (ai.items && ai.items.length > 0) {
    // Un movimiento de compra por cada ítem del documento
    for (const item of ai.items) {
      const qty   = Number(item.quantity ?? 1);
      const price = Number(item.unitCost ?? (item.total && qty ? item.total / qty : 0));
      if (price > 0 || qty > 0) {
        cfg.movements.push({
          date:     docDate,
          type:     'purchase',
          detail:   `${supplier} — ${item.description ?? 'Ítem'}`,
          quantity: qty,
          unitCost: price,
          fromDocument: true,
        });
      }
    }
  } else if ((ai.totalAmount ?? 0) > 0) {
    // Sin ítems: un solo movimiento por el total
    cfg.movements.push({
      date:     docDate,
      type:     'purchase',
      detail:   `${supplier} — Compra desde documento`,
      quantity: 1,
      unitCost: Number(ai.totalAmount ?? ai.netAmount ?? 0),
      fromDocument: true,
    });
  }

  return cfg;
}

/**
 * MANO_DE_OBRA: agrega (o actualiza) el departamento especificado en el
 * documento. Si el departamento ya existe, NO lo pisa.
 */
function populateDirectLabor(current: DirectLaborConfig | null, ai: AiExtractedData): DirectLaborConfig {
  const cfg: DirectLaborConfig = current ? JSON.parse(JSON.stringify(current)) : {
    workingDays: {
      totalDaysPerYear: 365,
      unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 0, holidaysOnWeekend: 0 },
      paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 },
    },
    itcs: { derivationBase: 0.27, fixedArt: 0.015, uncertainRemunerative: [], uncertainNonRemunerative: [] },
    departments: [],
  };

  if (!Array.isArray(cfg.departments)) cfg.departments = [];

  const deptName = ai.department?.trim() ?? 'Departamento s/d';
  const remuneration = Number(ai.totalAmount ?? ai.netAmount ?? 0);
  const hours = Number(ai.hoursWorked ?? 0);

  // Solo agregar si no existe un departamento con ese nombre
  const exists = cfg.departments.some(
    (d) => d.name.toLowerCase() === deptName.toLowerCase()
  );

  if (!exists && (remuneration > 0 || hours > 0)) {
    cfg.departments.push({
      name:              deptName,
      basicRemuneration: remuneration,
      hoursWorked:       hours,
      fromDocument:      true,
    });
  }

  return cfg;
}

/**
 * COSTOS_INDIRECTOS: agrega el documento como un concepto nuevo de CIF
 * con su monto fijo. No pisa conceptos previos.
 */
function populateIndirectCosts(current: IndirectCostConfig | null, ai: AiExtractedData, supplier?: string | null): IndirectCostConfig {
  const cfg: IndirectCostConfig = current ? JSON.parse(JSON.stringify(current)) : {
    centers: [],
    concepts: [],
    serviceDistributions: [],
    productiveSettings: [],
  };

  if (!Array.isArray(cfg.concepts)) cfg.concepts = [];

  const amount = Number(ai.totalAmount ?? ai.netAmount ?? 0);
  if (amount <= 0) return cfg; // sin monto no hay concepto útil

  const name = supplier?.trim() ?? ai.items?.[0]?.description ?? 'CIF desde documento';

  cfg.concepts.push({
    name,
    amount:       { fixed: amount, variable: 0 },
    distribution: {}, // El costista distribuye entre centros manualmente
    fromDocument: true,
  });

  return cfg;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Encuentra la CostStructure activa (ACTIVE o la más reciente en DRAFT) de
 * la empresa, y la actualiza con los datos aprobados del documento.
 *
 * Es no-fatal: si no hay estructura o el mapeo falla, se loguea y se continúa.
 */
export async function populateCostStructureFromApproval(
  db: PrismaClient,
  params: {
    companyId:    string;
    costistId:    string;
    costSection:  string;
    reviewNote:   string | null;
    supplier:     string | null;
  },
): Promise<void> {
  const { companyId, costistId, costSection, reviewNote, supplier } = params;

  // 1. Parsear el análisis de la IA
  const ai = parseReviewNote(reviewNote);
  const extracted = ai?.extractedData;
  if (!extracted) {
    console.log('[populator] Sin extractedData en reviewNote — nada que poblar.');
    return;
  }

  // 2. Buscar la estructura activa de la empresa (la más reciente ACTIVE o DRAFT)
  const structure = await db.costStructure.findFirst({
    where: {
      companyId,
      userId: costistId,
      status: { in: ['ACTIVE', 'DRAFT'] },
    },
    orderBy: [
      { status: 'asc' }, // ACTIVE antes que DRAFT (asc ordena A antes que D)
      { updatedAt: 'desc' },
    ],
  });

  if (!structure) {
    console.log(`[populator] No se encontró CostStructure para company=${companyId}. El costista debe crearla primero.`);
    return;
  }

  // 3. Mergear según la sección de costo
  let updateData: Record<string, unknown> = {};

  try {
    if (costSection === 'MATERIA_PRIMA') {
      const updated = populateRawMaterial(
        structure.rawMaterialConfig as RawMaterialConfig | null,
        extracted,
      );
      updateData = { rawMaterialConfig: updated };

    } else if (costSection === 'MANO_DE_OBRA') {
      const updated = populateDirectLabor(
        structure.directLaborConfig as DirectLaborConfig | null,
        extracted,
      );
      updateData = { directLaborConfig: updated };

    } else if (costSection === 'COSTOS_INDIRECTOS') {
      const updated = populateIndirectCosts(
        structure.indirectCostConfig as IndirectCostConfig | null,
        extracted,
        supplier,
      );
      updateData = { indirectCostConfig: updated };

    } else {
      // VENTAS, DESCONOCIDO: no hay campo de config que poblar automáticamente
      console.log(`[populator] Sección ${costSection} no requiere populación automática de CostStructure.`);
      return;
    }

    // 4. Guardar
    await db.costStructure.update({
      where: { id: structure.id },
      data:  updateData,
    });

    console.log(`[populator] CostStructure ${structure.id} actualizada con datos de ${costSection}.`);

  } catch (err) {
    // No fatal: la aprobación ya está firme, solo se loguea el error
    console.error('[populator] Error al poblar CostStructure:', err);
  }
}
