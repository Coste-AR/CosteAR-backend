// src/infrastructure/classifier/utils/text-enricher.ts
/**
 * Convierte la respuesta de Groq (DocumentAnalysis) en texto enriquecido
 * que la cascada puede procesar como si fuera texto OCR.
 *
 * Esto resuelve el problema crítico de las imágenes:
 * rawContent = "[Archivo: factura.jpg]" → sin señales para capas 1-4
 * enrichedText = "TIPO: factura_compra\nCAE: ...\nCUIT: ..." → señales detectables
 */
export function buildEnrichedText(
  rawContent: string,
  aiAnalysis: {
    documentType?: string;
    quality?: string;
    extractedData?: {
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
    } | null;
  } | null,
): string {
  const parts: string[] = [];

  // Incluir el rawContent si no es solo el placeholder del archivo
  const isFilePlaceholder = /^\[Archivo:/i.test(rawContent.trim());
  if (rawContent && !isFilePlaceholder) {
    parts.push(rawContent);
  }

  if (!aiAnalysis) return parts.join('\n') || rawContent;

  const { documentType, extractedData: d } = aiAnalysis;

  // Tipo de documento — traduce al formato que usan las señales definitivas
  if (documentType) {
    // Mapear nombres de Groq a términos que los detectores de señales reconocen
    const typeMap: Record<string, string> = {
      factura_compra:      'FACTURA A FACTURA B FACTURA C',
      factura_venta:       'FACTURA A FACTURA B FACTURA C VENTA',
      remito:              'REMITO N°',
      liquidacion_sueldos: 'LIQUIDACIÓN DE HABERES RECIBO DE SUELDO',
      planilla_horas:      'PLANILLA DE HORAS TRABAJADAS',
      nota_debito:         'NOTA DE DÉBITO A NOTA DE DÉBITO B',
      nota_credito:        'NOTA DE CRÉDITO A NOTA DE CRÉDITO B',
      recibo:              'RECIBO N°',
    };
    const mapped = typeMap[documentType.toLowerCase()] ?? documentType;
    parts.push(mapped);
  }

  if (!d) return parts.join('\n') || rawContent;

  // Proveedor
  if (d.supplier) {
    parts.push(`Proveedor: ${d.supplier}`);
  }

  // Número de comprobante (puede contener formato de punto de venta)
  if (d.invoiceNumber) {
    parts.push(`Comprobante N° ${d.invoiceNumber}`);
    // Si tiene formato XXXX-XXXXXXXX intentamos que coincida con patrones de CAE/PTO VTA
    if (/^\d{4}-\d{8}$/.test(d.invoiceNumber)) {
      parts.push(`Punto de Venta ${d.invoiceNumber.split('-')[0]}`);
    }
  }

  // Fecha
  if (d.date) {
    parts.push(`Fecha: ${d.date}`);
  }

  // Importes — usar formato argentino para que los extractores los reconozcan
  const fmtARS = (n: number) =>
    new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(n);

  if (d.netAmount != null) parts.push(`Subtotal: $${fmtARS(d.netAmount)}`);
  if (d.taxAmount  != null) parts.push(`IVA 21%: $${fmtARS(d.taxAmount)}`);
  if (d.totalAmount != null) parts.push(`Total: $${fmtARS(d.totalAmount)}`);

  // Ítems — descripciones son clave para Layer 4 (MP vs CIP)
  if (d.items && d.items.length > 0) {
    parts.push('Detalle:');
    for (const item of d.items) {
      const qty  = item.quantity != null ? `${item.quantity} ` : '';
      const unit = item.unitCost != null ? ` P.U. $${fmtARS(item.unitCost)}` : '';
      const tot  = item.total    != null ? ` Total: $${fmtARS(item.total)}` : '';
      parts.push(`  - ${qty}${item.description}${unit}${tot}`);
    }
  }

  // Horas (planillas)
  if (d.hoursWorked != null) parts.push(`Horas trabajadas: ${d.hoursWorked}`);
  if (d.employeeCount != null) parts.push(`Empleados: ${d.employeeCount}`);
  if (d.department) parts.push(`Área/Departamento: ${d.department}`);

  return parts.filter(Boolean).join('\n');
}
