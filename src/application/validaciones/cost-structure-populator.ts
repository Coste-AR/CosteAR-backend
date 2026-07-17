// src/application/validaciones/cost-structure-populator.ts
//
// Cuando el costista aprueba un DataEntry, este módulo toma los datos extraídos
// por la IA (reviewNote) y los inserta/mergea en la CostStructure activa de la
// empresa. Soporta documentos con MÚLTIPLES secciones simultáneamente.
//
// Principio: NUNCA pisa datos ya ingresados por el costista manualmente.
// Solo AGREGA movimientos o registros nuevos con un tag "fromDocument: true".

import type { PrismaClient } from '@prisma/client';
import type {
  RawMaterialSectionData,
  DirectLaborSectionData,
  IndirectCostsSectionData,
  SalesSectionData,
} from '../../infrastructure/ai/groq-service.js';
import {
  classifySocialCharge,
  normalizeChargeName,
} from '../../domain/knowledge/social-charges-catalog.js';
import {
  requireWritablePeriod,
  type PeriodMirrorData,
} from '../cost-structures/period-sync.js';

// ─── Tipos internos de CostStructure ─────────────────────────────────────────

interface Movement {
  date: string;
  type: 'purchase' | 'consumption';
  detail: string;
  quantity: number;
  unitCost: number;
  fromDocument?: boolean;
}

interface RawMaterialConfig {
  wilson?: { annualDemand?: number; orderCost?: number; holdingRate?: number; unitCost?: number };
  stockPolicy?: { minConsumption?: number; maxConsumption?: number; minLeadTime?: number; maxLeadTime?: number; safetyStock?: number };
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
    unpaidAbsence?: { sundays?: number; saturdays?: number; unjustifiedAbsences?: number; holidaysOnWeekend?: number };
    paidAbsence?: { holidays?: number; vacations?: number; sickness?: number; specialLeaves?: number; workAccidents?: number };
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

interface CifCenter {
  id: string;
  name: string;
  type: 'productive' | 'service';
  fromDocument?: boolean;
}

interface IndirectCostConfig {
  centers?: CifCenter[];
  concepts?: CifConcept[];
  serviceDistributions?: unknown[];
  productiveSettings?: unknown[];
}

// ─── Parser del reviewNote ────────────────────────────────────────────────────

interface ReviewNoteShape {
  sections?: {
    rawMaterial?: RawMaterialSectionData;
    directLabor?: DirectLaborSectionData;
    indirectCosts?: IndirectCostsSectionData;
    sales?: SalesSectionData;
  };
  extractedData?: {
    date?: string | null;
    supplier?: string | null;
    totalAmount?: number | null;
    netAmount?: number | null;
    items?: { description: string; quantity?: number | null; unitCost?: number | null; total?: number | null }[];
    department?: string | null;
    hoursWorked?: number | null;
  };
  costSection?: string;
}

function parseReviewNote(raw: string | null): ReviewNoteShape | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return (p && typeof p === 'object') ? p as ReviewNoteShape : null;
  } catch {
    return null;
  }
}

function n(val: number | null | undefined, def = 0): number {
  if (val == null || !Number.isFinite(Number(val))) return def;
  return Number(val);
}

function formatDate(raw?: string | null): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

// ─── Populadores por sección ──────────────────────────────────────────────────

function populateRawMaterial(
  current: RawMaterialConfig | null,
  sec: RawMaterialSectionData,
): RawMaterialConfig {
  const cfg: RawMaterialConfig = current ? JSON.parse(JSON.stringify(current)) : {
    wilson: { annualDemand: 0, orderCost: 0, holdingRate: 0.3, unitCost: 0 },
    stockPolicy: { minConsumption: 0, maxConsumption: 0, minLeadTime: 0, maxLeadTime: 0, safetyStock: 0 },
    initialStock: { quantity: 0, unitCost: 0 },
    movements: [],
  };

  // Wilson: solo sobrescribe campos que el costista no haya puesto (valor 0)
  if (sec.wilson) {
    cfg.wilson = cfg.wilson ?? {};
    if (!cfg.wilson.annualDemand && sec.wilson.annualDemand) cfg.wilson.annualDemand = n(sec.wilson.annualDemand);
    if (!cfg.wilson.orderCost    && sec.wilson.orderCost)    cfg.wilson.orderCost    = n(sec.wilson.orderCost);
    if (!cfg.wilson.holdingRate  && sec.wilson.holdingRate)  cfg.wilson.holdingRate  = n(sec.wilson.holdingRate);
    if (!cfg.wilson.unitCost     && sec.wilson.unitCost)     cfg.wilson.unitCost     = n(sec.wilson.unitCost);
  }

  // Política de stock
  if (sec.stockPolicy) {
    cfg.stockPolicy = cfg.stockPolicy ?? {};
    const sp = sec.stockPolicy;
    if (!cfg.stockPolicy.minConsumption && sp.minConsumption) cfg.stockPolicy.minConsumption = n(sp.minConsumption);
    if (!cfg.stockPolicy.maxConsumption && sp.maxConsumption) cfg.stockPolicy.maxConsumption = n(sp.maxConsumption);
    if (!cfg.stockPolicy.minLeadTime    && sp.minLeadTime)    cfg.stockPolicy.minLeadTime    = n(sp.minLeadTime);
    if (!cfg.stockPolicy.maxLeadTime    && sp.maxLeadTime)    cfg.stockPolicy.maxLeadTime    = n(sp.maxLeadTime);
    if (!cfg.stockPolicy.safetyStock    && sp.safetyStock)    cfg.stockPolicy.safetyStock    = n(sp.safetyStock);
  }

  // Stock inicial
  if (sec.initialStock) {
    cfg.initialStock = cfg.initialStock ?? {};
    if (!cfg.initialStock.quantity && sec.initialStock.quantity) cfg.initialStock.quantity = n(sec.initialStock.quantity);
    if (!cfg.initialStock.unitCost && sec.initialStock.unitCost) cfg.initialStock.unitCost = n(sec.initialStock.unitCost);
  }

  // Movimientos: siempre se agregan (no pisan ninguno existente)
  if (!Array.isArray(cfg.movements)) cfg.movements = [];
  if (sec.movements && sec.movements.length > 0) {
    for (const m of sec.movements) {
      cfg.movements.push({
        date:         formatDate(m.date),
        type:         m.type === 'consumption' ? 'consumption' : 'purchase',
        detail:       m.detail ?? 'Mov. desde documento',
        quantity:     n(m.quantity),
        unitCost:     m.type === 'consumption' ? 0 : n(m.unitCost), // consumo: PPP lo calcula el sistema
        fromDocument: true,
      });
    }
  }

  return cfg;
}

export function populateDirectLabor(
  current: DirectLaborConfig | null,
  sec: DirectLaborSectionData,
): DirectLaborConfig {
  const cfg: DirectLaborConfig = current ? JSON.parse(JSON.stringify(current)) : {
    workingDays: {
      totalDaysPerYear: 0,
      unpaidAbsence: { sundays: 0, saturdays: 0, unjustifiedAbsences: 0, holidaysOnWeekend: 0 },
      paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 },
    },
    itcs: { derivationBase: 0.27, fixedArt: 0.015, uncertainRemunerative: [], uncertainNonRemunerative: [] },
    departments: [],
  };

  if (sec.workingDays) {
    cfg.workingDays = cfg.workingDays ?? {};
    const wd = sec.workingDays;
    if (!cfg.workingDays.totalDaysPerYear && wd.totalDaysPerYear)
      cfg.workingDays.totalDaysPerYear = n(wd.totalDaysPerYear);

    cfg.workingDays.unpaidAbsence = cfg.workingDays.unpaidAbsence ?? {};
    if (!cfg.workingDays.unpaidAbsence.sundays && wd.sundays) cfg.workingDays.unpaidAbsence.sundays = n(wd.sundays);
    if (!cfg.workingDays.unpaidAbsence.saturdays && wd.saturdays) cfg.workingDays.unpaidAbsence.saturdays = n(wd.saturdays);
    if (wd.unjustifiedAbsences != null) cfg.workingDays.unpaidAbsence.unjustifiedAbsences = n(wd.unjustifiedAbsences);
    if (wd.holidaysOnWeekend  != null) cfg.workingDays.unpaidAbsence.holidaysOnWeekend  = n(wd.holidaysOnWeekend);

    cfg.workingDays.paidAbsence = cfg.workingDays.paidAbsence ?? {};
    if (wd.holidays      != null) cfg.workingDays.paidAbsence.holidays      = n(wd.holidays);
    if (wd.vacations     != null) cfg.workingDays.paidAbsence.vacations     = n(wd.vacations);
    if (wd.sickness      != null) cfg.workingDays.paidAbsence.sickness      = n(wd.sickness);
    if (wd.specialLeaves != null) cfg.workingDays.paidAbsence.specialLeaves = n(wd.specialLeaves);
    if (wd.workAccidents != null) cfg.workingDays.paidAbsence.workAccidents = n(wd.workAccidents);
  }

  const normPercent = (val: number) => {
    return val > 1 ? val / 100 : val;
  };

  if (sec.itcs) {
    cfg.itcs = cfg.itcs ?? { derivationBase: 0.27, fixedArt: 0.015, uncertainRemunerative: [], uncertainNonRemunerative: [] };
    if (sec.itcs.derivationBase != null) cfg.itcs.derivationBase = normPercent(n(sec.itcs.derivationBase, 0.27));
    if (sec.itcs.fixedArt       != null) cfg.itcs.fixedArt       = normPercent(n(sec.itcs.fixedArt, 0.015));

    if (!Array.isArray(cfg.itcs.uncertainRemunerative))    cfg.itcs.uncertainRemunerative    = [];
    if (!Array.isArray(cfg.itcs.uncertainNonRemunerative)) cfg.itcs.uncertainNonRemunerative = [];

    // D-2 — Cargas sociales inciertas: la IA EXTRAE, el SISTEMA CLASIFICA.
    //
    // Solo las inciertas REMUNERATIVAS generan cargas derivadas (clase 8). Si una
    // no remunerativa (uniformes, viandas…) cae como remunerativa, el ITCS se infla
    // con derivadas que no corresponden. Por eso la clasificación NO se le cree a la
    // IA: la decide el catálogo de la cátedra.
    const incoming: { name: string; coefficient: number; aiHint: 'remunerative' | 'nonRemunerative' | null }[] = [
      // Formato nuevo: la IA no clasifica.
      ...(sec.itcs.uncertainCharges ?? []).map((i) => ({ ...i, aiHint: null })),
      // Formato viejo (documentos analizados antes de D-2): su clasificación es
      // apenas una pista, y solo se usa si el catálogo no reconoce el concepto.
      ...(sec.itcs.uncertainRemunerative ?? []).map((i) => ({ ...i, aiHint: 'remunerative' as const })),
      ...(sec.itcs.uncertainNonRemunerative ?? []).map((i) => ({ ...i, aiHint: 'nonRemunerative' as const })),
    ];

    for (const item of incoming) {
      const name = String(item.name ?? '').trim();
      if (!name) continue;
      // El IAP/ausentismo lo calcula el motor a partir de los días: no se carga acá.
      if (normalizeChargeName(name).startsWith('iap') || normalizeChargeName(name).startsWith('yap')) continue;

      // Catálogo primero. Si no lo reconoce: la pista de la IA; y si no hay pista,
      // va a NO remunerativa (la opción que NO infla el costo). El costista lo ve
      // en el formulario y lo mueve si corresponde.
      const kind = classifySocialCharge(name) ?? item.aiHint ?? 'nonRemunerative';
      const coefficient = normPercent(n(item.coefficient));

      // ¿Ya está cargado (en cualquiera de las dos listas)? Se compara el nombre
      // completo normalizado — nunca por las primeras letras, porque "Premio
      // Asistencia" y "Premio Productividad" son conceptos distintos.
      const target = kind === 'remunerative' ? cfg.itcs.uncertainRemunerative : cfg.itcs.uncertainNonRemunerative;
      const other  = kind === 'remunerative' ? cfg.itcs.uncertainNonRemunerative : cfg.itcs.uncertainRemunerative;
      const sameName = (r: { name: string }) => normalizeChargeName(r.name) === normalizeChargeName(name);

      const existing = target.find(sameName);
      if (existing) {
        // Nunca se pisa un coeficiente que ya puso el costista.
        if (!existing.coefficient) existing.coefficient = coefficient;
        continue;
      }
      // Si el costista ya lo tenía en la OTRA lista, se respeta su decisión:
      // no se mueve solo (mover cambiaría el costo sin avisar). El formulario avisa.
      if (other.some(sameName)) continue;

      target.push({ name, coefficient });
    }
  }

  if (!Array.isArray(cfg.departments)) cfg.departments = [];
  for (const dept of sec.departments ?? []) {
    const existing = cfg.departments.find((d) => d.name.toLowerCase() === dept.name.toLowerCase());
    if (existing) {
      if (!existing.basicRemuneration) existing.basicRemuneration = n(dept.basicRemuneration);
      if (!existing.hoursWorked) existing.hoursWorked = n(dept.hoursWorked);
    } else {
      cfg.departments.push({
        name:              dept.name,
        basicRemuneration: n(dept.basicRemuneration),
        hoursWorked:       n(dept.hoursWorked),
        fromDocument:      true,
      });
    }
  }

  return cfg;
}

function populateIndirectCosts(
  current: IndirectCostConfig | null,
  sec: IndirectCostsSectionData,
): IndirectCostConfig {
  const cfg: IndirectCostConfig = current ? JSON.parse(JSON.stringify(current)) : {
    centers: [], concepts: [], serviceDistributions: [], productiveSettings: [],
  };

  if (!Array.isArray(cfg.centers))  cfg.centers  = [];
  if (!Array.isArray(cfg.concepts)) cfg.concepts  = [];

  // Centros de costo
  for (const center of sec.centers ?? []) {
    const exists = cfg.centers.some((c) => c.id === center.id || c.name.toLowerCase() === center.name.toLowerCase());
    if (!exists) {
      cfg.centers.push({ id: center.id, name: center.name, type: center.type, fromDocument: true });
    }
  }

  // Mapa de IDs de centros por nombre (se usa más abajo para matchear los datos
  // de fin de mes por centro productivo).
  const centerMap: Record<string, string> = {};
  for (const c of cfg.centers) { centerMap[c.name.toLowerCase()] = c.id; }

  // Conceptos CIF — la IA aporta nombre e importes. La DISTRIBUCIÓN (prorrateo)
  // NUNCA se toma de la IA (E1): el reparto lo pone el costista a mano o lo deriva
  // una base de asignación. Los conceptos nuevos nacen con distribución vacía.
  for (const concept of sec.concepts ?? []) {
    const existing = cfg.concepts.find((c) => c.name.toLowerCase() === concept.name.toLowerCase());
    if (existing) {
      if (!existing.amount.fixed) existing.amount.fixed = n(concept.amountFixed);
      if (!existing.amount.variable) existing.amount.variable = n(concept.amountVariable);
    } else {
      cfg.concepts.push({
        name: concept.name,
        amount: { fixed: n(concept.amountFixed), variable: n(concept.amountVariable) },
        distribution: {},
        fromDocument: true,
      });
    }
  }

  // Sincronizar productiveSettings para que los nuevos centros productivos no queden fuera del cálculo
  if (!Array.isArray(cfg.productiveSettings)) cfg.productiveSettings = [];
  const productiveCenters = cfg.centers.filter(c => c.type === 'productive');
  for (const pc of productiveCenters) {
    const hasSetting = cfg.productiveSettings.some((ps: any) => ps?.centerId === pc.id);
    if (!hasSetting) {
      cfg.productiveSettings.push({
        centerId: pc.id,
        budget: { fixed: 0, variable: 0 },
        normalCapacity: 0,
        actualActivity: 0,
        actualCip: 0
      });
    }
  }

  // Cargar los datos de fin de mes por centro productivo que la IA haya extraído
  // (capacidad normal, actividad real, CIP real). El PRESUPUESTO no se toca: se deriva
  // del prorrateo al guardar. Solo se completan campos en 0 → nunca se pisa lo que ya
  // cargó el costista. El centro se matchea por nombre (centerMap) o por id.
  for (const src of sec.productiveSettings ?? []) {
    const ref = String(src.center ?? '').trim().toLowerCase();
    const centerId = centerMap[ref] ?? cfg.centers.find((c) => c.id === src.center)?.id;
    if (!centerId) continue;
    const setting = cfg.productiveSettings.find((ps: any) => ps?.centerId === centerId) as
      | { normalCapacity?: number; actualActivity?: number; actualCip?: number }
      | undefined;
    if (!setting) continue;
    if (!setting.normalCapacity && src.normalCapacity != null) setting.normalCapacity = n(src.normalCapacity);
    if (!setting.actualActivity && src.actualActivity != null) setting.actualActivity = n(src.actualActivity);
    if (!setting.actualCip && src.actualCip != null) setting.actualCip = n(src.actualCip);
  }

  // Sincronizar serviceDistributions para que los nuevos centros de servicio no queden vacíos
  if (!Array.isArray(cfg.serviceDistributions)) cfg.serviceDistributions = [];
  const serviceCenters = cfg.centers.filter(c => c.type === 'service');
  for (const sc of serviceCenters) {
    const hasDist = cfg.serviceDistributions.some((sd: any) => sd?.serviceCenterId === sc.id);
    if (!hasDist) {
      cfg.serviceDistributions.push({
        serviceCenterId: sc.id,
        toProductive: {},
        toProductiveFixed: {},
        toProductiveVariable: {}
      });
    }
  }

  return cfg;
}

// ─── Función principal ────────────────────────────────────────────────────────

export async function populateCostStructureFromApproval(
  db: PrismaClient,
  params: {
    companyId:        string;
    costistId:        string;
    costSection:      string;
    reviewNote:       string | null;
    supplier:         string | null;
    /** Producto destino elegido por el cargador. Si viene, la población va
     *  EXACTAMENTE a esa estructura (aislamiento por producto). */
    costStructureId?: string | null;
  },
): Promise<void> {
  const { companyId, costistId, reviewNote, costStructureId } = params;

  const ai = parseReviewNote(reviewNote);
  if (!ai) {
    console.log('[populator] reviewNote vacío o inválido — nada que poblar.');
    return;
  }

  // Si el dato apunta a un producto específico, se usa ESE (aislamiento).
  // Si no, se cae al comportamiento previo: la CostStructure activa más reciente.
  const structure = costStructureId
    ? await db.costStructure.findFirst({
        where: { id: costStructureId, companyId, userId: costistId, deletedAt: null },
      })
    : await db.costStructure.findFirst({
        where: { companyId, userId: costistId, status: { in: ['ACTIVE', 'DRAFT'] }, deletedAt: null },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      });

  if (!structure) {
    console.log(`[populator] No hay CostStructure destino para company=${companyId}. Crear primero.`);
    return;
  }

  const secs = ai.sections ?? {};
  const updateData: Record<string, unknown> = {};

  try {
    // ── Materia Prima ──────────────────────────────────────────────────────────
    if (secs.rawMaterial?.present) {
      updateData.rawMaterialConfig = populateRawMaterial(
        structure.rawMaterialConfig as RawMaterialConfig | null,
        secs.rawMaterial,
      );
    }

    // ── Mano de Obra ──────────────────────────────────────────────────────────
    if (secs.directLabor?.present) {
      updateData.directLaborConfig = populateDirectLabor(
        structure.directLaborConfig as DirectLaborConfig | null,
        secs.directLabor,
      );
    }

    // ── Costos Indirectos ─────────────────────────────────────────────────────
    if (secs.indirectCosts?.present) {
      updateData.indirectCostConfig = populateIndirectCosts(
        structure.indirectCostConfig as IndirectCostConfig | null,
        secs.indirectCosts,
      );
    }

    // ── Ventas ────────────────────────────────────────────────────────────────
    if (secs.sales?.present) {
      if (secs.sales.unitPrice != null && Number(secs.sales.unitPrice) > 0) {
        updateData.salesUnitPrice = Number(secs.sales.unitPrice);
      }
      if (secs.sales.quantity != null && Number(secs.sales.quantity) > 0) {
        updateData.salesQuantity = Number(secs.sales.quantity);
      }
    }

    if (Object.keys(updateData).length === 0) {
      console.log('[populator] El documento no contenía secciones con present:true — nada que poblar.');
      return;
    }

    // C — Fase 3: un documento tampoco entra a un mes cerrado, y lo que entra al
    // mes abierto tiene que quedar también en el período (es el dueño del mes).
    const period = await requireWritablePeriod(db, structure.id);

    await db.costStructure.update({ where: { id: structure.id }, data: updateData });
    if (period) {
      await db.costPeriod.update({
        where: { id: period.id },
        data: updateData as PeriodMirrorData,
      });
    }
    console.log(`[populator] CostStructure ${structure.id} actualizada. Secciones: ${Object.keys(updateData).join(', ')}`);

  } catch (err) {
    console.error('[populator] Error al poblar CostStructure:', err);
  }
}
