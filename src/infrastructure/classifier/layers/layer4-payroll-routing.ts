import type { Layer4Result } from './layer4-business-routing.js';

export const MOD_ROLE_KEYWORDS = [
  'jornalero', 'jornalera', 'jornal', 'operario', 'operaria', 'operarios',
  'operador de máquina', 'operador de maquina', 'operador de línea', 'operador de linea',
  'operador de producción', 'operador de produccion', 'maquinista',
  'peón de producción', 'peon de produccion', 'peón', 'peon', 'obrero', 'obrera',
  'personal de producción', 'personal de produccion', 'personal de línea', 'personal de linea',
  'mano de obra directa',
];

export const CIP_ROLE_KEYWORDS = [
  'capataz', 'supervisor', 'supervisora', 'encargado', 'encargada',
  'jefe de producción', 'jefe de produccion', 'jefe de planta', 'jefe de turno',
  'jefe de fábrica', 'jefe de fabrica',
  'gerente de producción', 'gerente de produccion', 'gerente de planta',
  'gerente de fábrica', 'gerente de fabrica',
  'limpieza', 'personal de limpieza', 'maestranza',
  'vigilancia', 'vigilador', 'guardia de seguridad', 'sereno', 'portero', 'ordenanza',
  'mantenimiento', 'personal de mantenimiento',
  'control de calidad', 'controlador de calidad', 'foreman',
];

export const ADMIN_ROLE_KEYWORDS = [
  'administrativo', 'administrativa', 'personal administrativo', 'empleado administrativo',
  'gerente general', 'gerente de administración', 'gerente de administracion',
  'gerente administrativo', 'gerente comercial', 'gerente de ventas',
  'gerente de finanzas', 'gerente financiero',
  'director', 'directorio', 'contador', 'recepcionista', 'secretaria', 'secretario',
  'recursos humanos', 'rrhh', 'tesorería', 'tesoreria', 'cobranzas',
  'gerente',
];

type PayrollRoleBucket = 'MOD' | 'CIP' | 'ADMIN' | 'UNKNOWN';

function matchAnyKeyword(haystack: string, keywords: string[]): string | null {
  for (const kw of keywords) if (haystack.includes(kw)) return kw;
  return null;
}

export function extractRoleFromText(text: string): string | null {
  const labeled = text.match(/(?:puesto|cargo|categor[ií]a|funci[oó]n)\s*[:\-]\s*([^\n]+)/i);
  if (labeled?.[1]) return labeled[1].trim();
  const empleado = text.match(/empleado\s*[:\-]\s*([^\n]+)/i);
  if (empleado?.[1]) return empleado[1].trim();
  return null;
}

export function classifyPayrollRole(role: string | null): {
  bucket: PayrollRoleBucket;
  matched: string | null;
} {
  if (!role || !role.trim()) return { bucket: 'UNKNOWN', matched: null };
  const r = role.toLowerCase();
  const cip = matchAnyKeyword(r, CIP_ROLE_KEYWORDS);
  if (cip) return { bucket: 'CIP', matched: cip };
  const admin = matchAnyKeyword(r, ADMIN_ROLE_KEYWORDS);
  if (admin) return { bucket: 'ADMIN', matched: admin };
  const mod = matchAnyKeyword(r, MOD_ROLE_KEYWORDS);
  if (mod) return { bucket: 'MOD', matched: mod };
  return { bucket: 'UNKNOWN', matched: null };
}

export function routePayroll(text: string, extractedRole?: string | null): Layer4Result {
  const role = (extractedRole?.trim() || extractRoleFromText(text)) || null;
  const { bucket, matched } = classifyPayrollRole(role);

  if (bucket === 'CIP') {
    return {
      costSection: 'COSTOS_INDIRECTOS',
      suggestedSection: 'COSTOS_INDIRECTOS',
      confidence: 60,
      requiresAI: true,
      reasoning: `Liquidación de "${role}" (${matched}) → mano de obra INDIRECTA de producción, no MOD → candidato: Costos Indirectos de Producción (requiere confirmación)`,
    };
  }
  if (bucket === 'ADMIN') {
    return {
      costSection: 'GASTO_ADMINISTRACION',
      suggestedSection: 'GASTO_ADMINISTRACION',
      confidence: 60,
      requiresAI: true,
      reasoning: `Liquidación de "${role}" (${matched}) → personal administrativo / de conducción, fuera de producción → candidato: Gasto de Administración (requiere confirmación)`,
    };
  }

  let note: string;
  if (bucket === 'MOD') {
    note = `puesto directo de producción (${matched})`;
  } else if (role) {
    note = `puesto "${role}" no reconocido → no contradice mano de obra directa, se asume MOD (revisar)`;
  } else {
    note = 'sin puesto informado → se asume MOD (LIMITACIÓN CONOCIDA: sin señal de rol no se distingue MOD de mano de obra indirecta)';
  }
  return {
    costSection: 'MANO_DE_OBRA',
    confidence: 99,
    requiresAI: false,
    reasoning: `Liquidación de haberes o planilla de horas → Mano de Obra Directa (${note})`,
  };
}
