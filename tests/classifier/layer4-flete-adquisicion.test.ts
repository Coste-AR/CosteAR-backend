/**
 * CL-06 — El flete SOBRE UNA COMPRA de materia prima sigue a esa materia prima,
 * aunque venga facturado aparte por el transportista.
 *
 * LA REGLA. R-ADQUISICION, Clase 4, ll. 15-18: *"Costo de nacionalización +
 * flete carretero hasta destino (ej. Tucumán) = costo de adquisición total"*.
 * El flete sobre la COMPRA de un material integra el costo de ese material; el
 * flete DENTRO de la planta es CIP (R-CIP, Clase 1, l. 64). Misma palabra, dos
 * destinos — y el destino lo declara el propio comprobante.
 *
 * QUÉ SE MIDIÓ ANTES. La auditoría del 06/08/2026 midió el documento FLE-02
 * —"Flete por la compra de 38 toneladas de maíz - Factura 0003-00001902"— en
 * COSTOS_INDIRECTOS con confianza 97: un error de ALTA CONFIANZA, de los que no
 * se revisan y entran al costo del cliente en silencio. La causa era que la
 * regla de adquisición solo se aplicaba cuando la línea de flete estaba en la
 * MISMA factura que la MP, y 'flete' es una UNIVERSAL_CIP_KEYWORD.
 *
 * POR QUÉ ESTOS TESTS SON DETERMINISTAS Y NO EL HARNESS DEL CORPUS. Corren sobre
 * `runLayer4`, sin tocar Groq ni la base. Esa es exactamente la propiedad que se
 * buscaba: el documento NO tiene que necesitar la IA para clasificarse bien. El
 * harness del corpus (`corpus-avicola.harness.test.ts`) no es determinista —
 * `temperature: 0.05` sin `seed`— así que una sola pasada suya no distingue una
 * mejora real del ruido del muestreo. Esta es la evidencia fuerte.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runLayer4 } from '@/infrastructure/classifier/layers/layer4-business-routing.js';
import { detectAcquisitionCostLink } from '@/infrastructure/classifier/layers/layer4-acquisition-link.js';

// Los textos salen del corpus, no de una copia: si el corpus cambia, estos tests
// miden el documento nuevo y no una versión congelada acá.
const CORPUS_PATH = fileURLToPath(
  new URL('../../corpus-clasificador/corpus.json', import.meta.url),
);
const casos: Array<{ id: string; text: string }> =
  JSON.parse(readFileSync(CORPUS_PATH, 'utf8')).casos;
const textoDe = (id: string): string => {
  const c = casos.find((x) => x.id === id);
  if (!c) throw new Error(`El corpus no tiene el caso ${id}`);
  return c.text;
};

const facturaFlete = (detalle: string) => `
FACTURA A
CAE Nº: 75200000000401
CUIT: 30-66889900-3
PUNTO DE VENTA 0005
Proveedor: Transportes Rivadavia SRL
Fecha: 22/06/2026
${detalle}
`;

describe('Layer 4 — flete facturado aparte sobre una compra de MP (CL-06)', () => {
  it('FLE-02, el documento exacto de la auditoría, ya no va a Costos Indirectos', () => {
    const r = runLayer4('FACTURA_COMPRA', textoDe('FLE-02'), 'AVICULTURA');

    expect(r.costSection).toBe('MATERIA_PRIMA');
    // El error medido fue COSTOS_INDIRECTOS con confianza 97.
    expect(r.costSection).not.toBe('COSTOS_INDIRECTOS');
    // Y lo resuelve la regla, no la IA: es el criterio de aceptación fuerte.
    expect(r.requiresAI).toBe(false);
  });

  it('el ANTES, reproducido: sin la declaración de compra el mismo papel cae a la IA', () => {
    // Es el estado exacto del que se venía. FLE-02 puntuaba 1 señal de Materia
    // Prima ('maíz') contra 'flete' —una UNIVERSAL_CIP_KEYWORD—, no llegaba al
    // margen de 2 y salía DESCONOCIDO/requiresAI. De ahí lo agarraba la IA, que
    // con el hint "flete de granos es COSTOS_INDIRECTOS" respondía CIP conf 97.
    // Lo único que cambió en este texto es que se le sacó "por la compra".
    const r = runLayer4(
      'FACTURA_COMPRA',
      facturaFlete('Flete de 38 toneladas de maíz - Factura 0003-00001902'),
      'AVICULTURA',
    );

    expect(r.requiresAI).toBe(true);
    expect(r.costSection).toBe('DESCONOCIDO');
  });

  it('lee el comprobante referenciado y lo deja disponible para el libro', () => {
    const r = runLayer4('FACTURA_COMPRA', textoDe('FLE-02'), 'AVICULTURA');

    expect(r.acquisitionLink?.referencedComprobante).toBe('0003-00001902');
    expect(r.acquisitionLink?.declaredBy).toMatch(/flete por la compra/i);
  });

  it('el comprobante leído es el que MP-MAIZ-REF declara como propio (cadena cerrada)', () => {
    const flete = runLayer4('FACTURA_COMPRA', textoDe('FLE-02'), 'AVICULTURA');
    const compra = runLayer4('FACTURA_COMPRA', textoDe('MP-MAIZ-REF'), 'AVICULTURA');

    expect(compra.costSection).toBe('MATERIA_PRIMA');
    expect(textoDe('MP-MAIZ-REF')).toContain(flete.acquisitionLink!.referencedComprobante!);
  });

  it.each(['AVICULTURA', 'AGRO', 'DEFAULT'] as const)(
    'bajo el perfil %s el resultado es el mismo — no depende del rubro',
    (perfil) => {
      const r = runLayer4('FACTURA_COMPRA', textoDe('FLE-02'), perfil);

      expect(r.costSection).toBe('MATERIA_PRIMA');
      expect(r.requiresAI).toBe(false);
    },
  );

  it('sin número de comprobante legible clasifica igual: la sección la da el texto', () => {
    // El vínculo queda sin resolver, pero la naturaleza contable del importe no
    // depende de que se pueda leer el número de la otra factura.
    const r = runLayer4(
      'FACTURA_COMPRA',
      facturaFlete('Flete por la compra de 38 toneladas de maíz\nDestino: establecimiento Tucumán'),
      'AVICULTURA',
    );

    expect(r.costSection).toBe('MATERIA_PRIMA');
    expect(r.requiresAI).toBe(false);
    expect(r.acquisitionLink).toBeDefined();
    expect(r.acquisitionLink!.referencedComprobante).toBeNull();
  });

  it('el flete sigue a lo comprado: si lo transportado es CIP, el flete es CIP', () => {
    const r = runLayer4(
      'FACTURA_COMPRA',
      facturaFlete('Flete por la compra de chapa de techo para galpones - Factura 0003-00002110'),
      'AVICULTURA',
    );

    expect(r.costSection).toBe('COSTOS_INDIRECTOS');
    expect(r.acquisitionLink?.referencedComprobante).toBe('0003-00002110');
  });

  it('si el comprobante no dice QUÉ se transportó, escala en vez de adivinar', () => {
    const r = runLayer4(
      'FACTURA_COMPRA',
      facturaFlete('Flete correspondiente a la compra s/ Factura 0003-00001902'),
      'AVICULTURA',
    );

    expect(r.requiresAI).toBe(true);
    expect(r.costSection).toBe('DESCONOCIDO');
    expect(r.suggestedSection).toBe('MATERIA_PRIMA');
    expect(r.acquisitionLink?.referencedComprobante).toBe('0003-00001902');
  });
});

describe('Layer 4 — el flete de planta NO se rompió (guarda de regresión, CL-06 CA-2)', () => {
  it('FLE-01, flete interno entre galpones, sigue yendo a Costos Indirectos', () => {
    const r = runLayer4('FACTURA_COMPRA', textoDe('FLE-01'), 'AVICULTURA');

    expect(r.costSection).toBe('COSTOS_INDIRECTOS');
    expect(r.requiresAI).toBe(false);
    expect(r.acquisitionLink).toBeUndefined();
  });

  it('un flete de reparto a clientes NO se declara vínculo de adquisición', () => {
    // Contrapeso deliberado: el flete de ENTREGA no es costo de adquisición de
    // nada. Que el documento hable de una compra no alcanza si habla de la venta.
    const r = runLayer4(
      'FACTURA_COMPRA',
      facturaFlete('Flete por la venta de 500 maples al cliente - reparto a clientes de Tucumán'),
      'AVICULTURA',
    );

    expect(r.acquisitionLink).toBeUndefined();

    // ⚠️ LÍMITE PREEXISTENTE, DECLARADO Y NO TOCADO: este documento igual cae en
    // MATERIA_PRIMA, porque 'maple'/'maples' son mpKeywords de AVICULTURA y el
    // camino viejo (flete en la misma factura) los toma como la compra que el
    // flete acompaña. Es el mismo comportamiento que antes de CL-06 — el flete
    // de entrega al cliente sería GASTO_COMERCIALIZACION y no lo resuelve nadie
    // todavía. Se deja documentado en vez de ensanchar CL-06 hasta ahí: mezclar
    // las dos correcciones haría imposible saber cuál movió qué.
    expect(r.costSection).toBe('MATERIA_PRIMA');
  });
});

describe('detectAcquisitionCostLink — el disparador es estrecho a propósito', () => {
  it('no dispara sobre la compra de MP en sí (MP-MAIZ-REF cita su propio número)', () => {
    expect(detectAcquisitionCostLink(textoDe('MP-MAIZ-REF').toLowerCase())).toBeNull();
  });

  it('no dispara sobre una factura de compra que trae el flete adentro', () => {
    // Ese caso lo resuelve el camino viejo (flete en la misma factura). Si este
    // detector se lo comiera, le cambiaría la explicación al costista sin motivo.
    const link = detectAcquisitionCostLink(
      'factura de compra: bobina de acero 500 kg (materia prima) + flete y seguro de transporte',
    );
    expect(link).toBeNull();
  });

  it('no dispara sobre el flete de planta aunque el documento diga "flete"', () => {
    expect(detectAcquisitionCostLink(
      'factura de flete y logística: servicio de transporte y acarreo de la planta',
    )).toBeNull();
  });

  it('no confunde un CUIT ni un CAE con un número de comprobante', () => {
    const link = detectAcquisitionCostLink(
      'cuit: 30-66889900-3\ncae nº: 75200000000401\nflete por la compra de maíz',
    );
    expect(link).not.toBeNull();
    expect(link!.referencedComprobante).toBeNull();
  });

  it.each([
    ['con "s/"',       'flete s/ compra de maíz, factura 0003-00001902'],
    ['con "s/" pegado', 'flete s/compra de maíz'],
    ['con "según"',    'acarreo según compra de maíz'],
    ['con "sobre la"', 'seguro de la carga sobre la compra de maíz, fc 0003-00001902'],
  ])('reconoce la declaración %s', (_etiqueta, texto) => {
    expect(detectAcquisitionCostLink(texto)).not.toBeNull();
  });

  it('normaliza el número de comprobante a la forma canónica PPPP-NNNNNNNN', () => {
    // Muchos comprobantes imprimen el número sin los ceros a la izquierda; el
    // libro tiene que poder compararlo contra el que guardó la otra factura.
    const link = detectAcquisitionCostLink('flete por la compra de maíz — comprobante 0003-1902');
    expect(link!.referencedComprobante).toBe('0003-00001902');
  });
});
