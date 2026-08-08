/**
 * CL-02 — "No sé qué puesto es" no puede significar "mano de obra directa".
 *
 * Antes de esta corrección, la rama UNKNOWN de routePayroll devolvía EXACTAMENTE
 * el mismo objeto que la rama MOD: MANO_DE_OBRA, confianza 99, requiresAI false.
 * Nada aguas abajo podía distinguir "sé que es un operario" de "no tengo idea de
 * qué es esto".
 *
 * La auditoría del 06/08/2026 midió que dos de los siete errores de alta
 * confianza salían de acá, y que el `requiresAI: false` de esta rama era además
 * lo que hacía que Layer 4 pisara a la IA y colapsara los documentos MULTIPLE.
 *
 * Regla de la cátedra (Clase 1, l. 59-60): MOD es quien "transforma la MP en
 * producto final"; capataz, gerente y supervisión son mano de obra INDIRECTA.
 * Sin saber el puesto no se puede determinar cuál es, y lo correcto es escalar.
 *
 * Tests puros: no tocan Groq ni la base.
 */
import { describe, it, expect } from 'vitest';
import { routePayroll, classifyPayrollRole } from '@/infrastructure/classifier/layers/layer4-payroll-routing.js';

const recibo = (puesto?: string) =>
  ['RECIBO DE SUELDO', puesto ? `Empleado: ${puesto}` : null, 'SUELDO BÁSICO', 'ANSES', 'JUBILACIÓN']
    .filter(Boolean)
    .join('\n');

describe('routePayroll — lo que NO se puede romper (guardas de regresión)', () => {
  it('un operario de galpón sigue siendo MOD con confianza alta y sin pasar por la IA', () => {
    const r = routePayroll(recibo('Marcos Villalba — Operario de galpón de postura'));

    expect(r.costSection).toBe('MANO_DE_OBRA');
    expect(r.confidence).toBe(99);
    expect(r.requiresAI).toBe(false);
  });

  it('un capataz sigue yendo a CIP pidiendo confirmación', () => {
    const r = routePayroll(recibo('Héctor Sosa — Capataz de galpones'));

    expect(r.costSection).toBe('COSTOS_INDIRECTOS');
    expect(r.confidence).toBe(60);
    expect(r.requiresAI).toBe(true);
  });

  it('un gerente administrativo sigue yendo a Gasto de Administración', () => {
    const r = routePayroll(recibo('Ana Torres — Gerente administrativo'));

    expect(r.costSection).toBe('GASTO_ADMINISTRACION');
    expect(r.requiresAI).toBe(true);
  });
});

describe('routePayroll — la rama UNKNOWN ya no afirma mano de obra directa', () => {
  it('un recibo SIN puesto no se imputa a MANO_DE_OBRA y escala', () => {
    const r = routePayroll(recibo());

    expect(r.costSection).not.toBe('MANO_DE_OBRA');
    expect(r.requiresAI).toBe(true);
    expect(r.confidence).toBeLessThan(90);
  });

  it('una veterinaria (puesto real, fuera de las listas) no se afirma como MOD', () => {
    const r = routePayroll(recibo('Laura Bianchi — Veterinaria responsable de sanidad del plantel'));

    // Puede quedar MANO_DE_OBRA como hipótesis, pero NO afirmada: tiene que
    // pedir la IA y no puede llevar confianza alta.
    expect(r.requiresAI).toBe(true);
    expect(r.confidence).toBeLessThan(90);
  });

  it('la rama sin puesto y la rama con puesto desconocido son distinguibles entre sí', () => {
    const sinPuesto = routePayroll(recibo());
    const puestoRaro = routePayroll(recibo('Técnico de incubación'));

    // Son dos grados de ignorancia distintos: no pueden colapsar en el mismo
    // resultado, porque el segundo le da a la IA un dato que el primero no tiene.
    expect(sinPuesto.confidence).not.toBe(puestoRaro.confidence);
  });

  it('EL BUG: ninguna rama UNKNOWN puede devolver la misma forma que la rama MOD', () => {
    const mod = routePayroll(recibo('Operario de producción'));
    const forma = (r: ReturnType<typeof routePayroll>) =>
      `${r.costSection}/${r.confidence}/${r.requiresAI}`;

    for (const texto of [recibo(), recibo('Veterinaria responsable de sanidad del plantel'), recibo('Bioquímico de laboratorio')]) {
      expect(
        forma(routePayroll(texto)),
        `"${texto.split('\n')[1] ?? 'sin puesto'}" quedó indistinguible de un operario`,
      ).not.toBe(forma(mod));
    }
  });

  it('no manda suggestedSection: ese campo le afirmaría a la IA que el puesto NO es MOD', () => {
    // En cascade-classifier, suggestedSection dispara un hint que dice
    // literalmente "un puesto que NO es mano de obra directa". Es correcto para
    // capataz/gerente, pero acá justamente no se sabe: mandarlo sería cambiar un
    // sesgo por otro.
    expect(routePayroll(recibo()).suggestedSection).toBeUndefined();
    expect(routePayroll(recibo('Veterinaria del plantel')).suggestedSection).toBeUndefined();

    // En cambio capataz y administrativo SÍ deben mandarlo.
    expect(routePayroll(recibo('Capataz de galpones')).suggestedSection).toBe('COSTOS_INDIRECTOS');
  });

  it('la explicación no le dice al costista que se asumió MOD cuando no se sabe', () => {
    const r = routePayroll(recibo());

    expect(r.reasoning).not.toMatch(/se asume MOD/i);
    expect(r.reasoning).toMatch(/no se puede|sin el puesto/i);
  });
});

describe('classifyPayrollRole — los puestos reales de una avícola caen en UNKNOWN', () => {
  // Documenta el hueco que CL-02 NO cierra a propósito: la corrección es que el
  // caso desconocido se comporte bien, no que las listas sean exhaustivas.
  // Estos puestos son candidatos a agregar, pero agregarlos no reemplaza el fix.
  it.each([
    'Veterinaria responsable de sanidad del plantel',
    'Bioquímico de laboratorio',
    'Responsable de bioseguridad',
    'Técnico de incubación',
  ])('«%s» todavía no está en ninguna lista', (puesto) => {
    expect(classifyPayrollRole(puesto).bucket).toBe('UNKNOWN');
  });
});
