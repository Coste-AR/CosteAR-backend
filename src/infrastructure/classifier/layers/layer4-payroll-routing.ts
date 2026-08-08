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
  // `[:-]` con el guion al final de la clase ya es literal: escaparlo no cambia
  // qué matchea, solo agrega ruido.
  const labeled = text.match(/(?:puesto|cargo|categor[ií]a|funci[oó]n)\s*[:-]\s*([^\n]+)/i);
  if (labeled?.[1]) return labeled[1].trim();
  const empleado = text.match(/empleado\s*[:-]\s*([^\n]+)/i);
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

  if (bucket === 'MOD') {
    return {
      costSection: 'MANO_DE_OBRA',
      confidence: 99,
      requiresAI: false,
      reasoning: `Liquidación de haberes o planilla de horas → Mano de Obra Directa (puesto directo de producción: ${matched})`,
    };
  }

  // ── bucket === 'UNKNOWN' ───────────────────────────────────────────────────
  //
  // Antes, estas dos ramas devolvían EXACTAMENTE el mismo objeto que la rama MOD
  // de arriba: MANO_DE_OBRA con confianza 99 y requiresAI false. O sea que "no sé
  // qué puesto es" era indistinguible de "sé que es un operario", y se imputaba a
  // mano de obra directa sin pasar por la IA ni por un humano.
  //
  // La regla de la cátedra (Clase 1) es que MOD es quien "transforma la MP en
  // producto final". Sin saber el puesto, eso no se puede determinar: lo correcto
  // es escalar, nunca afirmar MOD.
  //
  // Medido en la auditoría del 06/08/2026: dos de los siete errores de alta
  // confianza salían de acá (un recibo sin puesto y uno de "Veterinaria
  // responsable de sanidad del plantel", ambos MANO_DE_OBRA con confianza 99).
  // Además el requiresAI:false de esta rama es lo que hacía que Layer 4 pisara a
  // la IA en cascade-classifier, colapsando los documentos MULTIPLE a una sola
  // sección.
  //
  // Las dos ramas devuelven requiresAI:true y confianzas bajas y distintas entre
  // sí: son dos grados de ignorancia diferentes y el resto del sistema tiene que
  // poder distinguirlos.
  //
  // NOTA: deliberadamente NO se setea `suggestedSection`. En cascade-classifier
  // ese campo dispara un hint que le afirma a la IA que el puesto "NO es mano de
  // obra directa", lo cual es cierto para capataz/gerente pero NO acá, donde
  // justamente no se sabe. Mandar ese hint sería cambiar un sesgo por otro.

  if (role) {
    // Hay un puesto declarado, pero no está en ninguna de las tres listas. Puede
    // ser MOD perfectamente (una lista de keywords nunca es exhaustiva), así que
    // MANO_DE_OBRA queda como hipótesis principal para el caso en que la IA no
    // esté disponible — pero con confianza baja y pidiendo confirmación.
    return {
      costSection: 'MANO_DE_OBRA',
      confidence: 50,
      requiresAI: true,
      reasoning: `Liquidación de haberes o planilla de horas de "${role}": el puesto no coincide con ninguna lista conocida (directo de producción / indirecto / administrativo), así que no se puede determinar si transforma la materia prima. Hipótesis: Mano de Obra Directa, sin confirmar.`,
    };
  }

  // Ni siquiera hay puesto declarado: es el grado máximo de ignorancia. Acá ni
  // siquiera hay una hipótesis defendible, así que el fallback sin IA es
  // DESCONOCIDO — que escala a un humano — en vez de una imputación inventada.
  return {
    costSection: 'DESCONOCIDO',
    confidence: 25,
    requiresAI: true,
    reasoning: 'Liquidación de haberes o planilla de horas sin puesto informado: sin el puesto no se puede distinguir mano de obra directa de indirecta ni de personal administrativo. Requiere que alguien indique de qué puesto se trata.',
  };
}
