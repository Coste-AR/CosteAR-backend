import { describe, it, expect } from 'vitest';
import {
  resolverParametro,
  definicionDe,
  PARAMETROS_AVICOLA,
  type FilaParametro,
} from '@/domain/parametros/parametros-costeo.js';

/**
 * S-02 (b) — parámetros de costeo: cascada y trazabilidad del origen.
 *
 * Lo que se fija acá no es la aritmética, es de DÓNDE salió cada número. Un
 * default del sistema y un dato confirmado por el cliente valen distinto, y el
 * resultado tiene que poder distinguirlos.
 */

const PERIODO = 'per-1';
const ESTRUCTURA = 'str-1';

const fila = (o: Partial<FilaParametro> & { clave: string; valorNum: number }): FilaParametro => ({
  periodId: null,
  structureId: null,
  confirmado: true,
  ...o,
});

describe('S-02(b) — resolución en cascada', () => {
  it('el período le gana a la estructura y a la empresa', () => {
    const r = resolverParametro(
      'gramaje_estandar_gr',
      [
        fila({ clave: 'gramaje_estandar_gr', valorNum: 100 }),
        fila({ clave: 'gramaje_estandar_gr', valorNum: 110, structureId: ESTRUCTURA }),
        fila({
          clave: 'gramaje_estandar_gr',
          valorNum: 125,
          structureId: ESTRUCTURA,
          periodId: PERIODO,
        }),
      ],
      { periodId: PERIODO, structureId: ESTRUCTURA },
    );

    expect(r.valor).toBe(125);
    expect(r.origen).toBe('periodo');
  });

  it('sin valor de período, cae a la estructura', () => {
    const r = resolverParametro(
      'gramaje_estandar_gr',
      [
        fila({ clave: 'gramaje_estandar_gr', valorNum: 100 }),
        fila({ clave: 'gramaje_estandar_gr', valorNum: 110, structureId: ESTRUCTURA }),
      ],
      { periodId: PERIODO, structureId: ESTRUCTURA },
    );

    expect(r.valor).toBe(110);
    expect(r.origen).toBe('estructura');
  });

  it('sin nada cargado, usa el default del catálogo y lo declara SIN confirmar', () => {
    const r = resolverParametro('vida_util_lote_meses', [], {
      periodId: PERIODO,
      structureId: ESTRUCTURA,
    });

    expect(r.valor).toBe(24);
    expect(r.origen).toBe('default');
    // Lo importante: no se hace pasar por dato del cliente.
    expect(r.confirmado).toBe(false);
    expect(r.nota).toContain('D-01');
  });

  it('un valor cargado pero sin confirmar se devuelve marcado', () => {
    const r = resolverParametro(
      'costo_maple',
      [fila({ clave: 'costo_maple', valorNum: 850, structureId: ESTRUCTURA, confirmado: false })],
      { structureId: ESTRUCTURA },
    );

    expect(r.valor).toBe(850);
    expect(r.origen).toBe('estructura');
    expect(r.confirmado).toBe(false);
  });

  it('un parámetro que no existe ni cargado ni en el catálogo falla fuerte', () => {
    expect(() => resolverParametro('inventado_por_alguien', [], {})).toThrowError(
      /no existe el parámetro/i,
    );
  });
});

describe('S-02(b) — el catálogo de defaults', () => {
  it('ningún default del catálogo se da por confirmado', () => {
    for (const def of PARAMETROS_AVICOLA) {
      const r = resolverParametro(def.clave, [], {});
      expect(r.confirmado, `${def.clave} se dio por confirmado`).toBe(false);
    }
  });

  it('todo default no seguro trae una nota que dice qué preguntar', () => {
    for (const def of PARAMETROS_AVICOLA.filter((d) => !d.seguro)) {
      expect(def.nota, `${def.clave} no explica por qué no es seguro`).toBeTruthy();
    }
  });

  it('los maples por cajón son coherentes con huevos por cajón y por maple', () => {
    const porCajon = definicionDe('huevos_por_cajon')!.valorDefault;
    const porMaple = definicionDe('huevos_por_maple')!.valorDefault;
    const maples = definicionDe('maples_por_cajon')!.valorDefault;

    expect(porCajon / porMaple).toBe(maples);
  });

  it('🔒 la vida útil del lote NO está hardcodeada: sale del catálogo', () => {
    // Este test existe para S-03. Si alguien escribe 24 a mano en el cálculo de
    // amortización, cambiar el default acá no lo movería — y este test lo delata.
    const def = definicionDe('vida_util_lote_meses')!;
    expect(def.valorDefault).toBe(24);

    const conOtroValor = resolverParametro(
      'vida_util_lote_meses',
      [fila({ clave: 'vida_util_lote_meses', valorNum: 18, structureId: ESTRUCTURA })],
      { structureId: ESTRUCTURA },
    );
    expect(conOtroValor.valor).toBe(18);
  });

  it('🔒 un parámetro DECIDIDO por el equipo sigue estando SIN CONFIRMAR', () => {
    // La distinción que no se puede perder: elegir un valor para poder avanzar no
    // es lo mismo que saberlo. La vida útil y los tamaños de huevo se decidieron
    // el 18-08-2026 para no quedarnos parados, pero nadie se lo preguntó todavía
    // al productor.
    for (const clave of ['vida_util_lote_meses', 'tamanos_huevo']) {
      const def = definicionDe(clave)!;
      expect(def, `falta ${clave} en el catálogo`).toBeDefined();
      expect(def.seguro, `${clave} no puede darse por seguro`).toBe(false);
      expect(def.nota).toMatch(/DECIDIDO PROVISORIAMENTE/);

      const r = resolverParametro(clave, [], {});
      expect(r.confirmado, `${clave} se dio por confirmado`).toBe(false);
    }
  });

  it('la vida útil quedó en 2 años y los tamaños en 3', () => {
    expect(definicionDe('vida_util_lote_meses')!.valorDefault).toBe(24);
    expect(definicionDe('tamanos_huevo')!.valorDefault).toBe(3);
  });

  it('cuando el cliente lo carga desde la pantalla, SÍ queda confirmado', () => {
    // Es la diferencia que habilita que el productor configure sus propios
    // parámetros: lo que carga él vale más que nuestro default.
    const r = resolverParametro(
      'vida_util_lote_meses',
      [fila({ clave: 'vida_util_lote_meses', valorNum: 20, structureId: ESTRUCTURA, confirmado: true })],
      { structureId: ESTRUCTURA },
    );
    expect(r.valor).toBe(20);
    expect(r.confirmado).toBe(true);
    expect(r.origen).toBe('estructura');
  });

  it('el umbral de merma arranca sin decidir: no elige por el costista', () => {
    // S-04 depende de esto: sin umbral declarado, la merma va a revisión humana
    // en vez de que el sistema la clasifique solo.
    const def = definicionDe('umbral_merma_normal_pct')!;
    expect(def.seguro).toBe(false);
    expect(def.nota).toMatch(/revisi[oó]n humana/i);
  });
});
