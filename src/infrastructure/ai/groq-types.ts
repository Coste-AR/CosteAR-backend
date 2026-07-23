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
    uncertainCharges?: { name: string; coefficient: number }[];
    uncertainRemunerative?: { name: string; coefficient: number }[];
    uncertainNonRemunerative?: { name: string; coefficient: number }[];
  };
  departments?: { name: string; basicRemuneration: number; hoursWorked: number }[];
}

export interface IndirectCostsSectionData {
  present: boolean;
  centers?: { id: string; name: string; type: 'productive' | 'service' }[];
  concepts?: { name: string; amountFixed: number; amountVariable: number }[];
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
    role?: string | null;
    hoursWorked?: number | null;
    employeeCount?: number | null;
  };
  sections?: {
    rawMaterial?: RawMaterialSectionData;
    directLabor?: DirectLaborSectionData;
    indirectCosts?: IndirectCostsSectionData;
    sales?: SalesSectionData;
  };
  requiresReview?: boolean;
}

export interface ClassifyResponse {
  documentType: string;
  costSection: string;
  confidence: number;
  reasoning: string;
  requiresReview?: boolean;
}
