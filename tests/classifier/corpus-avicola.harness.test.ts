/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HARNESS DEL CORPUS AVÍCOLA — la vara de medición de las correcciones CL-*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * QUÉ MIDE
 * --------
 * Corre `corpus-clasificador/corpus.json` contra `classifyDocument` y reporta
 * las TRES métricas que pide `Plan-Implementacion-Clasificador-2026-08-06.md`:
 *
 *   1. Accuracy                        — cuántos casos caen en la sección correcta.
 *   2. Precisión a confianza ≥90       — de los que el sistema afirma con ≥90,
 *                                        cuántos acierta. **Es la que más importa**:
 *                                        un error con confianza 97 no se revisa,
 *                                        entra al costo del cliente en silencio.
 *   3. Errores de alta confianza       — el conteo crudo de esos errores.
 *
 * POR QUÉ NO ASSERTA SOBRE LAS MÉTRICAS
 * -------------------------------------
 * Porque hoy el corpus falla a propósito: fue construido a partir de los errores
 * que la auditoría midió, y las correcciones CL-01..CL-09 todavía no están hechas.
 * Un umbral acá sería rojo desde el día uno y se terminaría ignorando.
 *
 * Lo que sí asserta es más útil y más estricto:
 *
 *   · GUARDAS DE REGRESIÓN — los casos que hoy están BIEN deben seguir estando
 *     bien. Rompen la suite si una corrección los daña.
 *   · CONTRATO DE FALLOS CONOCIDOS — la lista `FALLOS_CONOCIDOS` declara qué
 *     casos se sabe que fallan hoy. Si uno deja de fallar, el test avisa para
 *     que se saque de la lista (y quede protegido como guarda). Si uno que no
 *     está en la lista empieza a fallar, el test se pone rojo.
 *     Es decir: el progreso es visible y la regresión es imposible de ignorar.
 *
 * ⚠️ SOBRE LOS NÚMEROS
 * --------------------
 * Este corpus es una RECONSTRUCCIÓN (ver corpus-clasificador/ground-truth.md).
 * Su accuracy absoluta NO es comparable contra la línea de base de la auditoría
 * (67,6 %): tiene 18 casos y está sesgado hacia los errores conocidos, así que es
 * pesimista por construcción. Sirve para comparar ANTES vs. DESPUÉS de un cambio.
 *
 * CÓMO CORRERLO
 * -------------
 *   npx vitest run tests/classifier/corpus-avicola.harness.test.ts --reporter=basic
 *
 * Para la comparación de perfiles de CL-04 (AGRO vs DEFAULT vs AVICULTURA):
 *   CORPUS_PERFILES=1 npx vitest run tests/classifier/corpus-avicola.harness.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyDocument } from '@/infrastructure/classifier/cascade-classifier.js';
import type { CostSection } from '@/infrastructure/classifier/types.js';

// UUIDs válidos → evita el ruido de prisma en getCorrectionExamples.
const BASE = {
  costistId: '00000000-0000-4000-8000-000000000011',
  companyId: '00000000-0000-4000-8000-000000000012',
  dataEntryId: '00000000-0000-4000-8000-000000000013',
};

// ── Forma del corpus ─────────────────────────────────────────────────────────

export interface CorpusCase {
  id: string;
  origen: 'medido' | 'requisito';
  correccion: string;
  expected: CostSection;
  /** Cuando true, lo correcto es escalar a revisión humana, no una sección. */
  esperaEscalamiento?: boolean;
  /** Casos que HOY están bien y no se pueden romper. */
  esGuardaDeRegresion?: boolean;
  montos?: Record<string, number>;
  baseline: { costSection?: string; confidence?: number; ok?: boolean; nota?: string } | null;
  nota: string;
  regla: string;
  text: string;
  referenciaComprobante?: string;
  esComprobanteReferenciado?: string;
}

interface Corpus {
  meta: Record<string, unknown>;
  casos: CorpusCase[];
}

const CORPUS_PATH = fileURLToPath(
  new URL('../../corpus-clasificador/corpus.json', import.meta.url),
);

export function loadCorpus(): Corpus {
  return JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as Corpus;
}

// ── Perfiles de rubro ────────────────────────────────────────────────────────
//
// El perfil se elige por el string `industry` que se le pasa al clasificador, vía
// categorizeIndustry(). Estos tres strings son los que usa la comparación de CL-04.
//
// ⚠️ EL STRING SOLO ELIGE LA CATEGORÍA — NO VIAJA A LA IA.
// Una versión anterior de este comentario (y de ground-truth.md) afirmaba que el
// string de rubro influía en Layer 5 por su cuenta, porque "Establecimiento avícola
// de postura" y no pasar rubro —que hasta CL-04 resolvían los dos a DEFAULT— daban
// distinto en CIP-02. Se verificó en el código y es FALSO: `input.industry` se usa
// en un solo lugar, `cascade-classifier.ts:230` (categorizeIndustry). Lo que llega
// al prompt de Groq es `industryProfile.label` y la categoría, nunca el string
// crudo (cascade-classifier.ts:448 → groq-classifier.ts:29-30). Dos strings que
// resuelven a la misma categoría producen un prompt idéntico byte por byte.
// Aquella diferencia en CIP-02 era ruido de muestreo (temperature 0,05, sin seed):
// es justamente lo que motivó CORPUS_REPETICIONES.
//
// Consecuencia práctica: cualquier string que resuelva a la categoría X mide el
// perfil X. Por eso la fila AGRO puede usar un string genérico sin perder validez.
//
// AGRO: desde CL-04, "avicultura"/"avícola" resuelven a AVICULTURA (que es el
// punto: el cliente no puede volver a caer en AGRO). Así que para seguir midiendo
// el perfil AGRO —la vara contra la que el perfil nuevo tiene que ganar— hace falta
// un string que lo seleccione. 'Productora agropecuaria' matchea `agro` y nada de
// AVICOLA_RE. La medición es equivalente a la del 07/08/2026 por lo dicho arriba.
export const PERFILES = {
  AGRO: 'Productora agropecuaria',
  DEFAULT: undefined,
  AVICULTURA: 'Establecimiento avícola de postura',
} as const;

export type PerfilLabel = keyof typeof PERFILES;

/**
 * El perfil con el que se atiende al cliente, y por lo tanto bajo el cual se mide.
 *
 * Fue 'AGRO' hasta CL-04. Pasó a 'AVICULTURA' porque el perfil nuevo le gana a los
 * otros dos en la comparación de tres vías (ver ground-truth.md § La comparación de
 * tres vías): accuracy 83,3 % vs. 72,2 % (DEFAULT) y 61,1 % (AGRO), con 0 errores de
 * alta confianza contra 2 de AGRO. Medir bajo AGRO ahora sería medir un perfil que
 * ya no se le aplica a nadie.
 */
const PERFIL_BASE: PerfilLabel = 'AVICULTURA';

// ── Métricas ─────────────────────────────────────────────────────────────────

export interface ResultadoCaso {
  id: string;
  esperado: CostSection;
  /** Sección de la MAYORÍA de las repeticiones (ver REPETICIONES). */
  obtenido: CostSection;
  confianza: number;
  escala: boolean;
  ok: boolean;
  /** Error afirmado con confianza ≥90: el que entra al costo sin que nadie lo mire. */
  errorAltaConfianza: boolean;
  /**
   * false cuando las repeticiones no coincidieron entre sí. Un caso inestable
   * es un hallazgo por derecho propio: el mismo comprobante clasifica distinto
   * según la corrida.
   */
  estable: boolean;
  /** Todas las secciones obtenidas, en orden, para poder auditar la inestabilidad. */
  respuestas: CostSection[];
  explicacion: string;
}

export interface Metricas {
  perfil: PerfilLabel;
  total: number;
  aciertos: number;
  accuracy: number;
  altaConfianzaTotal: number;
  altaConfianzaAciertos: number;
  /** null cuando ningún caso llegó a confianza ≥90 (no hay denominador). */
  precisionAltaConfianza: number | null;
  erroresAltaConfianza: number;
  /** Casos cuyas repeticiones no coincidieron entre sí. */
  inestables: string[];
  resultados: ResultadoCaso[];
}

const UMBRAL_ALTA_CONFIANZA = 90;

/**
 * Cuántas veces se clasifica cada documento antes de quedarse con la mayoría.
 *
 * POR QUÉ HACE FALTA: `groq-classifier.ts:92` usa `temperature: 0.05` y no manda
 * `seed`, así que la Layer 5 NO es determinista. Medido: dos corridas idénticas
 * del mismo corpus, sin tocar una línea de código, dieron 61,1 % y 66,7 % de
 * accuracy (6 y 5 errores de alta confianza). Con una sola pasada, "medí antes y
 * después" no distingue una mejora real del ruido del muestreo.
 *
 * 3 repeticiones sobre 18 casos son 54 llamadas (~USD 0,03 por corrida completa),
 * costo despreciable frente a mergear una corrección creyendo que mejoró algo.
 *
 * ⚠️ Esto MITIGA el ruido, no lo elimina. La solución de fondo es que el
 * clasificador sea reproducible (`temperature: 0` + `seed` fijo), que además es
 * lo correcto de cara al cliente: subir dos veces el mismo comprobante debería
 * dar el mismo resultado. Está fuera del alcance de las 9 correcciones CL-*, así
 * que se deja anotado y no se toca acá.
 */
const REPETICIONES = Number(process.env.CORPUS_REPETICIONES ?? 1);

/** Devuelve el elemento más frecuente; ante empate, el primero que apareció. */
function mayoria<T>(xs: T[]): T {
  const conteo = new Map<T, number>();
  for (const x of xs) conteo.set(x, (conteo.get(x) ?? 0) + 1);
  return [...conteo.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Corre el corpus completo bajo un perfil de rubro y devuelve las métricas.
 * Exportada para que la tarea CL-04 pueda hacer la comparación de tres vías
 * sin duplicar esta lógica.
 */
export async function correrCorpus(perfil: PerfilLabel): Promise<Metricas> {
  const { casos } = loadCorpus();
  const industry = PERFILES[perfil];
  const resultados: ResultadoCaso[] = [];

  for (const c of casos) {
    const corridas = [];
    for (let i = 0; i < REPETICIONES; i++) {
      corridas.push(await classifyDocument({
        ...BASE,
        text: c.text,
        industry,
        groqQuality: 'legible',
      }));
    }

    const respuestas = corridas.map((r) => r.costSection);
    const seccion = mayoria(respuestas);
    const estable = respuestas.every((s) => s === seccion);
    // Se reportan los atributos de la corrida que quedó en mayoría, para que la
    // confianza y la explicación sean coherentes con la sección informada.
    const r = corridas.find((x) => x.costSection === seccion)!;

    // Un caso que espera escalamiento acierta si el sistema pide revisión,
    // sin importar a qué sección haya tirado mientras tanto.
    const ok = c.esperaEscalamiento
      ? mayoria(corridas.map((x) => x.requiresReview)) === true
      : seccion === c.expected;

    const altaConfianza = r.confidence >= UMBRAL_ALTA_CONFIANZA && !r.requiresReview;

    resultados.push({
      id: c.id,
      esperado: c.expected,
      obtenido: seccion,
      confianza: r.confidence,
      escala: r.requiresReview,
      ok,
      errorAltaConfianza: altaConfianza && !ok,
      estable,
      respuestas,
      explicacion: r.explanation,
    });
  }

  const aciertos = resultados.filter((r) => r.ok).length;
  const altaConf = resultados.filter((r) => r.confianza >= UMBRAL_ALTA_CONFIANZA && !r.escala);
  const altaConfAciertos = altaConf.filter((r) => r.ok).length;

  return {
    perfil,
    total: resultados.length,
    aciertos,
    accuracy: (aciertos / resultados.length) * 100,
    altaConfianzaTotal: altaConf.length,
    altaConfianzaAciertos: altaConfAciertos,
    precisionAltaConfianza: altaConf.length ? (altaConfAciertos / altaConf.length) * 100 : null,
    erroresAltaConfianza: altaConf.length - altaConfAciertos,
    inestables: resultados.filter((r) => !r.estable).map((r) => r.id),
    resultados,
  };
}

const LABEL: Record<string, string> = {
  MATERIA_PRIMA: 'MP', MANO_DE_OBRA: 'MOD', COSTOS_INDIRECTOS: 'CIP',
  VENTAS: 'VTA', MULTIPLE: 'MULTI', DESCONOCIDO: '???',
  GASTO_COMERCIALIZACION: 'G-COM', GASTO_ADMINISTRACION: 'G-ADM', GASTO_FINANCIERO: 'G-FIN',
};

export function reportar(m: Metricas): string {
  const filas = [
    'ID'.padEnd(18) + 'ESP'.padEnd(7) + 'OBT'.padEnd(7) + 'CONF'.padEnd(6) + 'ESCALA'.padEnd(8) + 'R',
  ];
  for (const r of m.resultados) {
    const estado = r.ok ? 'OK' : r.errorAltaConfianza ? 'XX ⚠ alta confianza' : 'XX';
    filas.push(
      r.id.padEnd(18) +
      LABEL[r.esperado].padEnd(7) +
      LABEL[r.obtenido].padEnd(7) +
      String(r.confianza).padEnd(6) +
      (r.escala ? 'sí' : 'no').padEnd(8) +
      estado +
      (r.estable ? '' : `  ~inestable: ${r.respuestas.map((s) => LABEL[s]).join('/')}`),
    );
  }
  const prec = m.precisionAltaConfianza === null
    ? 'sin denominador (ningún caso llegó a ≥90 sin escalar)'
    : `${m.altaConfianzaAciertos}/${m.altaConfianzaTotal} = ${m.precisionAltaConfianza.toFixed(1)} %`;

  return [
    `\n══ PERFIL ${m.perfil} ══  (mayoría de ${REPETICIONES} repeticiones por caso)`,
    filas.join('\n'),
    `\n  Accuracy .......................... ${m.aciertos}/${m.total} = ${m.accuracy.toFixed(1)} %`,
    `  Precisión a confianza ≥90 ......... ${prec}`,
    `  Errores de ALTA CONFIANZA ......... ${m.erroresAltaConfianza}`,
    `  Casos INESTABLES entre corridas ... ${m.inestables.length}${m.inestables.length ? ` (${m.inestables.join(', ')})` : ''}`,
    '',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRATO DE FALLOS CONOCIDOS
//
// Casos que HOY fallan, con la corrección que los va a arreglar. Cuando una
// corrección aterriza, su caso deja de fallar y este test avisa para que se
// saque de la lista — pasando así de "fallo conocido" a guarda de regresión.
//
// Es deliberado que esto sea una lista y no un umbral: un umbral deja pasar
// que un caso se arregle y otro se rompa sin que nadie se entere.
// ─────────────────────────────────────────────────────────────────────────────
const FALLOS_CONOCIDOS: Record<string, string> = {
  'MO-03':   'CL-02 — la rama UNKNOWN de routePayroll afirma MOD con confianza alta',
  'MO-04':   'CL-02 — recibo sin puesto: debe escalar, hoy afirma MOD con confianza alta',
  'MULTI-01':'CL-02 — Layer 4 pisa el MULTIPLE de la IA al reportar requiresAI:false',
  // CIP-01 salió de esta lista: CL-05 le dio keywords ('energía eléctrica',
  // 'electricidad', 'kwh') y arregló el `\benergia\b` sin tilde, así que ahora
  // lo resuelve Layer 4 sin llamar a la IA. Pasó a guarda de regresión en
  // corpus.json.
  // CIP-02 y CIP-04 salieron de esta lista: CL-04 creó el perfil AVICULTURA
  // (fuelIsMP:false + 'grupo electrógeno'/'calefacción' en cipKeywords para el
  // gasoil; 'vacuna' fuera de mpKeywords y dentro de cipKeywords). Los dos los
  // resuelve ahora Layer 4 con requiresAI:false, o sea de forma determinista y
  // sin que la IA pueda cambiarlos. Pasaron a guardas de regresión en corpus.json.
  'FLE-02':  'CL-06 — el flete sobre una compra de MP no sigue a esa MP',
};

/**
 * GA-05 NO está en la lista de arriba, a propósito.
 *
 * El plan lo reporta como fallo (la IA respondió GASTO_COMERCIALIZACION y Layer 4
 * lo pisó a MANO_DE_OBRA), pero en este corpus **clasifica bien** bajo los tres
 * perfiles. Es el único de los 8 fallos documentados que no se logró reproducir.
 *
 * La explicación más probable: para que Layer 4 lo pise a MANO_DE_OBRA, el
 * documento original tenía que disparar el ruteo de liquidación — o sea, parecer
 * un recibo de comisiones a un vendedor. La reconstrucción de acá es una factura
 * de proveedor por comisiones, que no lo dispara.
 *
 * No se forzó el texto para que fallara: fabricar un documento hasta que
 * reproduzca el bug es exactamente la clase de invención que este corpus evita.
 * CL-03 igual se puede verificar con un test dirigido sobre el mecanismo de
 * pisado, que es lo que su prompt pide ("construct the disagreement explicitly").
 *
 * Si algún día GA-05 empieza a fallar, el assert de `nuevos` de más abajo lo
 * levanta solo: no está declarado como fallo conocido, así que cuenta como
 * regresión.
 */

// Una sola corrida compartida por los tres tests: cada pasada son
// 18 casos × REPETICIONES llamadas a Groq, no tiene sentido triplicarlas.
let corridaBase: Promise<Metricas> | null = null;
const baseUnaVez = () => (corridaBase ??= correrCorpus(PERFIL_BASE));

// ─────────────────────────────────────────────────────────────────────────────
// OPT-IN a propósito: este harness pega contra la API de Groq, que tiene cuota.
//
// Medido el 07/08/2026: con la cuota del free tier agotada, Groq empezó a pedir
// esperas de 600-830s por llamada. Aun con el tope de CL-07 recortándolas a 60s,
// una pasada de 18 casos tardó 900s y timeouteó. Dejarlo en la suite por defecto
// haría que `npm test` fallara por el estado de una cuota externa y no por el
// código — el peor tipo de test flaky, porque enseña a ignorar el rojo.
//
// Es una vara de medición que se usa deliberadamente antes y después de una
// corrección, no una compuerta de CI:
//
//   CORPUS=1 npx vitest run tests/classifier/corpus-avicola.harness.test.ts
//   CORPUS=1 CORPUS_REPETICIONES=5 npx vitest run ...   (antes de declarar algo arreglado)
//   CORPUS=1 CORPUS_PERFILES=1 npx vitest run ...       (comparación de perfiles, CL-04)
// ─────────────────────────────────────────────────────────────────────────────
describe.runIf(process.env.CORPUS === '1')('Corpus avícola — vara de medición de las correcciones del clasificador', () => {
  it('mide accuracy, precisión a confianza ≥90 y errores de alta confianza', async () => {
    const m = await baseUnaVez();
    // eslint-disable-next-line no-console
    console.log(reportar(m));

    // Sanidad del corpus, no del clasificador: que el archivo se haya leído.
    expect(m.total).toBeGreaterThan(0);
  }, 300_000);

  it('guardas de regresión: los casos que hoy están bien siguen estando bien', async () => {
    const { casos } = loadCorpus();
    const guardas = casos.filter((c) => c.esGuardaDeRegresion).map((c) => c.id);
    expect(guardas.length).toBeGreaterThan(0);

    const m = await baseUnaVez();
    const rotas = m.resultados.filter((r) => guardas.includes(r.id) && !r.ok);

    expect(
      rotas.map((r) => `${r.id}: esperaba ${LABEL[r.esperado]}, dio ${LABEL[r.obtenido]}`),
      'Una corrección rompió un caso que antes estaba bien',
    ).toEqual([]);
  }, 300_000);

  it('contrato de fallos conocidos: ni se rompe nada nuevo ni se arregla en silencio', async () => {
    const m = await baseUnaVez();

    // Los casos inestables se excluyen de la parte que asserta: su resultado
    // depende del muestreo de la IA, así que exigirles un veredicto fijo
    // convertiría este test en flaky. Se reportan aparte, que es lo que
    // corresponde: la inestabilidad es un hallazgo, no un fallo de esta suite.
    const inestables = new Set(m.inestables);
    const fallanHoy = new Set(
      m.resultados.filter((r) => !r.ok && !inestables.has(r.id)).map((r) => r.id),
    );
    const declarados = new Set(Object.keys(FALLOS_CONOCIDOS));

    const nuevos = [...fallanHoy].filter((id) => !declarados.has(id));
    const yaArreglados = [...declarados].filter(
      (id) => !fallanHoy.has(id) && !inestables.has(id),
    );

    if (m.inestables.length) {
      // eslint-disable-next-line no-console
      console.log(
        `\n~ Casos INESTABLES (excluidos del contrato, ver REPETICIONES): ${m.inestables.join(', ')}\n` +
        '  El mismo comprobante clasificó distinto entre repeticiones. Si uno de estos\n' +
        '  es el que tenía que arreglar tu corrección, no alcanza con esta corrida:\n' +
        '  subí CORPUS_REPETICIONES o hacé un test dirigido sobre el mecanismo.\n',
      );
    }

    if (yaArreglados.length) {
      // eslint-disable-next-line no-console
      console.log(
        '\n✅ Estos casos ya no fallan. Sacalos de FALLOS_CONOCIDOS y marcalos como\n' +
        '   guarda de regresión en corpus.json (esGuardaDeRegresion: true):\n' +
        yaArreglados.map((id) => `   - ${id}: ${FALLOS_CONOCIDOS[id]}`).join('\n') + '\n',
      );
    }

    // Solo esto rompe la suite: un caso que empezó a fallar. Es la dirección que
    // importa proteger y es estable aun con 1 repetición.
    expect(nuevos, 'Casos que empezaron a fallar y no estaban declarados').toEqual([]);

    // `yaArreglados` NO asserta: con REPETICIONES=1 un caso puede "arreglarse"
    // por el muestreo de la IA y volver a fallar en la corrida siguiente. Se
    // informa arriba. Para confirmar que una corrección realmente arregló su
    // caso, corré con CORPUS_REPETICIONES=5 antes de sacarlo de FALLOS_CONOCIDOS.
  }, 300_000);

  // Comparación de tres vías para CL-04. Es cara (3 pasadas contra Groq), así que
  // corre solo bajo demanda: CORPUS_PERFILES=1 npx vitest run ...
  it.runIf(process.env.CORPUS_PERFILES === '1')(
    'compara AGRO vs DEFAULT vs AVICULTURA (CL-04)',
    async () => {
      const perfiles: PerfilLabel[] = ['AGRO', 'DEFAULT', 'AVICULTURA'];
      const ms: Metricas[] = [];
      for (const p of perfiles) ms.push(await correrCorpus(p));

      for (const m of ms) console.log(reportar(m));

      console.log('\n══ COMPARACIÓN ══');
      console.log('PERFIL'.padEnd(13) + 'ACCURACY'.padEnd(12) + 'PREC≥90'.padEnd(12) + 'ERR ALTA CONF');
      for (const m of ms) {
        const prec = m.precisionAltaConfianza === null ? '—' : `${m.precisionAltaConfianza.toFixed(1)} %`;
        console.log(
          m.perfil.padEnd(13) +
          `${m.accuracy.toFixed(1)} %`.padEnd(12) +
          prec.padEnd(12) +
          String(m.erroresAltaConfianza),
        );
      }
      console.log('');

      // Diferencias caso por caso: es lo que el plan pide reportar.
      const [agro, def, avi] = ms;
      const difieren = agro.resultados
        .map((_, i) => ({ agro: agro.resultados[i], def: def.resultados[i], avi: avi.resultados[i] }))
        .filter((t) => !(t.agro.obtenido === t.def.obtenido && t.def.obtenido === t.avi.obtenido));

      if (difieren.length) {
        console.log('── Casos donde los perfiles difieren ──');
        console.log('ID'.padEnd(18) + 'ESP'.padEnd(7) + 'AGRO'.padEnd(8) + 'DEFAULT'.padEnd(9) + 'AVICULTURA');
        for (const t of difieren) {
          console.log(
            t.agro.id.padEnd(18) +
            LABEL[t.agro.esperado].padEnd(7) +
            LABEL[t.agro.obtenido].padEnd(8) +
            LABEL[t.def.obtenido].padEnd(9) +
            LABEL[t.avi.obtenido],
          );
        }
        console.log('');
      }

      expect(ms).toHaveLength(3);
    },
    360_000,
  );
});
