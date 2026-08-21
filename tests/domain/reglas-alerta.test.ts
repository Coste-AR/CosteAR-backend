import { describe, it, expect } from 'vitest';
import {
  evaluarRegla,
  evaluarReglas,
  cumpleCondicion,
  REGLAS_AVICOLA_SEMILLA,
  type ReglaAlerta,
  type Lectura,
} from '@/domain/alertas/reglas-alerta.js';

/**
 * S-05b — reglas de alerta por indicador físico.
 *
 * Lo que más se prueba acá es **cuándo NO hay que decir nada**. Una pantalla que
 * alerta siempre es una pantalla que nadie mira.
 */

const dia = (d: number) => new Date(2026, 7, d);

const regla = (o: Partial<ReglaAlerta> = {}): ReglaAlerta => ({
  id: 'r-1',
  indicador: 'humedad_grano_ingreso',
  descripcion: 'Humedad del grano al ingreso',
  condicion: 'MAYOR',
  umbral: 16,
  unidad: '%',
  lecturasSostenidas: 1,
  severidad: 'CRITICA',
  activa: true,
  ...o,
});

describe('S-05b — cuándo NO hay que decir nada', () => {
  it('una lectura dentro de rango no genera hallazgo', () => {
    expect(evaluarRegla(regla(), [{ fecha: dia(10), valor: 14 }])).toBeNull();
  });

  it('justo en el umbral tampoco: MAYOR es estrictamente mayor', () => {
    expect(evaluarRegla(regla(), [{ fecha: dia(10), valor: 16 }])).toBeNull();
  });

  it('sin lecturas no se inventa nada', () => {
    expect(evaluarRegla(regla(), [])).toBeNull();
  });

  it('una regla desactivada no dispara aunque la lectura esté fuera de rango', () => {
    expect(evaluarRegla(regla({ activa: false }), [{ fecha: dia(10), valor: 25 }])).toBeNull();
  });

  it('🔒 sin valor de referencia, FUERA_DE_RANGO_PCT NO asume que está bien: se calla', () => {
    const r = regla({ condicion: 'FUERA_DE_RANGO_PCT', umbral: 10, indicador: 'peso_muestreo' });
    expect(evaluarRegla(r, [{ fecha: dia(10), valor: 1800 }])).toBeNull();
    expect(cumpleCondicion(r, { fecha: dia(10), valor: 1800, referencia: null })).toBe(false);
  });
});

describe('S-05b — la racha sostenida', () => {
  const postura = regla({
    indicador: 'postura_plantel',
    descripcion: 'Porcentaje de postura del plantel',
    condicion: 'MENOR',
    umbral: 85,
    lecturasSostenidas: 3,
    severidad: 'ADVERTENCIA',
  });

  it('dos días por debajo no alcanzan si la regla pide tres', () => {
    const l: Lectura[] = [
      { fecha: dia(12), valor: 82 },
      { fecha: dia(11), valor: 83 },
      { fecha: dia(10), valor: 88 },
    ];
    expect(evaluarRegla(postura, l)).toBeNull();
  });

  it('tres seguidos sí, y dice cuántas venían', () => {
    const l: Lectura[] = [
      { fecha: dia(12), valor: 82 },
      { fecha: dia(11), valor: 83 },
      { fecha: dia(10), valor: 84 },
      { fecha: dia(9), valor: 90 },
    ];
    const h = evaluarRegla(postura, l)!;
    expect(h).not.toBeNull();
    expect(h.lecturasEnCondicion).toBe(3);
    expect(h.explicacion.some((e) => e.includes('3 lectura'))).toBe(true);
  });

  it('🔒 la racha tiene que llegar hasta HOY: una vieja ya no es un problema abierto', () => {
    // Tres días malos, pero después se recuperó. No hay nada que avisar.
    const l: Lectura[] = [
      { fecha: dia(12), valor: 91 },
      { fecha: dia(11), valor: 82 },
      { fecha: dia(10), valor: 83 },
      { fecha: dia(9), valor: 84 },
    ];
    expect(evaluarRegla(postura, l)).toBeNull();
  });

  it('el orden en que llegan las lecturas no cambia el resultado', () => {
    const desordenadas: Lectura[] = [
      { fecha: dia(10), valor: 84 },
      { fecha: dia(12), valor: 82 },
      { fecha: dia(11), valor: 83 },
    ];
    expect(evaluarRegla(postura, desordenadas)!.lecturasEnCondicion).toBe(3);
  });
});

describe('S-05b — los mensajes se entienden sin contexto', () => {
  it('MAYOR nombra el valor y el límite', () => {
    const h = evaluarRegla(regla(), [{ fecha: dia(10), valor: 18.5 }])!;
    expect(h.mensaje).toContain('18,5 %');
    expect(h.mensaje).toContain('16 %');
    expect(h.mensaje).toMatch(/por encima/);
  });

  it('FUERA_DE_RANGO_PCT dice el desvío y en qué sentido', () => {
    const r = regla({
      indicador: 'peso_muestreo',
      descripcion: 'Peso por muestreo contra la tabla de la raza',
      condicion: 'FUERA_DE_RANGO_PCT',
      umbral: 10,
      unidad: 'g',
      severidad: 'ADVERTENCIA',
    });
    // 1.620 contra 1.800 = 10 % por debajo... justo en el borde no dispara.
    expect(evaluarRegla(r, [{ fecha: dia(10), valor: 1620, referencia: 1800 }])).toBeNull();

    const h = evaluarRegla(r, [{ fecha: dia(10), valor: 1500, referencia: 1800 }])!;
    expect(h.mensaje).toMatch(/por debajo/);
    expect(h.mensaje).toContain('16,7 %');
  });

  it('🔒 toda alerta aclara que no modifica ningún costo', () => {
    const h = evaluarRegla(regla(), [{ fecha: dia(10), valor: 20 }])!;
    expect(h.explicacion.some((e) => /no modifica ningún costo/i.test(e))).toBe(true);
  });
});

describe('S-05b — evaluar varias reglas', () => {
  it('lo más grave va primero', () => {
    const reglas = [
      regla({ id: 'a', indicador: 'dias_estiba', umbral: 14, severidad: 'ADVERTENCIA', descripcion: 'Días de estiba', unidad: 'días' }),
      regla({ id: 'b', indicador: 'humedad_grano_ingreso', umbral: 16, severidad: 'CRITICA' }),
    ];
    const h = evaluarReglas(reglas, {
      dias_estiba: [{ fecha: dia(10), valor: 20 }],
      humedad_grano_ingreso: [{ fecha: dia(10), valor: 18 }],
    });
    expect(h).toHaveLength(2);
    expect(h[0]!.severidad).toBe('CRITICA');
  });

  it('un indicador sin lecturas no rompe ni inventa hallazgo', () => {
    const h = evaluarReglas([regla()], {});
    expect(h).toHaveLength(0);
  });
});

describe('S-05b — las cuatro reglas que declaró el productor', () => {
  it('están las cuatro, con umbral configurable y unidad', () => {
    expect(REGLAS_AVICOLA_SEMILLA).toHaveLength(4);
    const indicadores = REGLAS_AVICOLA_SEMILLA.map((r) => r.indicador);
    expect(indicadores).toEqual(
      expect.arrayContaining([
        'humedad_grano_ingreso',
        'postura_plantel',
        'peso_muestreo',
        'dias_estiba',
      ]),
    );
    for (const r of REGLAS_AVICOLA_SEMILLA) {
      expect(r.umbral, `${r.indicador} sin umbral`).toBeGreaterThan(0);
      expect(r.descripcion.length, `${r.indicador} sin descripción`).toBeGreaterThan(5);
    }
  });

  it('la de postura es la única sostenida: una caída de un día puede ser el calor', () => {
    const postura = REGLAS_AVICOLA_SEMILLA.find((r) => r.indicador === 'postura_plantel')!;
    expect(postura.lecturasSostenidas).toBeGreaterThan(1);

    const otras = REGLAS_AVICOLA_SEMILLA.filter((r) => r.indicador !== 'postura_plantel');
    for (const r of otras) expect(r.lecturasSostenidas).toBe(1);
  });

  it('la humedad del grano es la única crítica: define si la bachada entra o no', () => {
    const humedad = REGLAS_AVICOLA_SEMILLA.find((r) => r.indicador === 'humedad_grano_ingreso')!;
    expect(humedad.severidad).toBe('CRITICA');
  });
});
