import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * VALIDACIONES CONSTRUIDAS Y NUNCA ENCHUFADAS.
 *
 * CosteAR tiene una costumbre documentada: construir la validación, testearla,
 * y no llamarla desde ningún lado. No es una sospecha, es un patrón con
 * precedente real:
 *
 *   · `checkRawMaterialConsistency` existía, tenía tests propios, y no la
 *     llamaba nadie. El sistema tenía el detector de inconsistencias de materia
 *     prima APAGADO. Fue un defecto de verdad — ver el comentario en
 *     `calculate.ts`, donde ahora sí se engancha, con el motivo escrito.
 *   · `GET /structures/:id/allocation-check` devuelve el mensaje correcto y no
 *     tiene un solo llamador en ninguno de los repos.
 *   · `desperdicio.ts` tiene su tabla, su migración y 181 líneas de test; su
 *     único importador es su propio archivo de test.
 *
 * Arreglar los síntomas de a uno no impide el próximo. Esto sí: cualquier
 * validación nueva que nazca desconectada se pone roja acá, el día que se
 * escribe y no seis meses después.
 *
 * ── POR QUÉ ES UN TEST ESTÁTICO Y NO DINÁMICO ────────────────────────────────
 *
 * Mismo motivo que `rls-coverage.test.ts`: el CI (`.github/workflows/ci.yml`)
 * corre lint, build y `npm run test`, sin Postgres. Un chequeo que necesitara
 * levantar la app y ejercitar rutas tendría que saltearse cuando no hay base, y
 * un control que se saltea justo en el único lugar por donde pasan TODOS los
 * cambios no protege nada: pasa en verde el día que alguien deja una validación
 * colgada.
 *
 * Y hay una razón más de fondo: "no la llama nadie" NO es observable en
 * runtime. Que una ruta no se ejercite durante una corrida no prueba que esté
 * muerta — prueba que esa corrida no pasó por ahí. Lo que sí es verificable es
 * que ningún archivo del repositorio la nombre, y eso se verifica leyendo el
 * código. Por eso es análisis estático: no necesita Docker, ni API, ni datos de
 * ningún cliente.
 *
 * ── ALCANCE: ESTE CHEQUEO SOLO VE EL BACKEND ─────────────────────────────────
 *
 * LIMITACIÓN REAL, no una nota al pie. `CosteAR-frontend` es otro repositorio:
 * un test que vive acá NO puede ver quién llama a una ruta desde la web. Una
 * ruta que solo consume el frontend se vería "muerta" desde acá aunque esté
 * perfectamente viva.
 *
 * Por eso esas rutas van en `EXENCIONES` con el archivo y la línea del frontend
 * que las llama: verificable a mano hoy, y revisable cuando cambie.
 * Equivocarse en cualquiera de las dos direcciones rompe el control:
 *
 *   · marcar como muerta una ruta que el frontend usa ⇒ ruido, y el ruido
 *     termina tapando el hallazgo real;
 *   · exentar como "la usa el frontend" una que no usa nadie ⇒ es exactamente
 *     el agujero que este archivo existe para cerrar.
 */

/**
 * Validaciones desconectadas A PROPÓSITO, cada una con su motivo.
 *
 * La clave es la ruta tal como se registra, o la ruta del módulo desde la raíz
 * del repositorio. Agregar una entrada acá es una decisión consciente que queda
 * escrita; NO poner nada y que el test siga verde es lo que este archivo evita.
 */
const EXENCIONES: Record<string, string> = {
  // --- Rutas que consume el frontend, que este test no puede ver ---
  '/auth/check-cuit':
    'La llama el formulario de registro para avisar "ese CUIT ya tiene cuenta" mientras se ' +
    'tipea, antes de enviar. Verificado en CosteAR-frontend, src/features/auth/RegisterPage.tsx:101.',
  '/auth/check-email':
    'El mismo formulario de registro, para el email. Verificado en CosteAR-frontend, ' +
    'src/features/auth/RegisterPage.tsx:86.',
  '/calculation-runs/:id/validate':
    'Es el botón de validar una corrida en la pantalla de trazabilidad. Verificado en ' +
    'CosteAR-frontend, src/features/cost-structures/trazabilidad-hooks.ts:131.',
  '/data-points/:id/validate':
    'Es la validación de un dato individual desde la ficha del dato. Verificado en ' +
    'CosteAR-frontend, src/features/cost-structures/trazabilidad-hooks.ts:279.',
};

// ---------------------------------------------------------------------------
// Lectura del código fuente
// ---------------------------------------------------------------------------

/** Lista recursiva de archivos `.ts` bajo `dir`, en rutas POSIX relativas a ROOT. */
function listarTs(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...listarTs(ruta));
    else if (entrada.name.endsWith('.ts')) salida.push(relative(ROOT, ruta).split('\\').join('/'));
  }
  return salida;
}

/**
 * Se ignoran los comentarios A PROPÓSITO.
 *
 * Una ruta nombrada en un comentario o en un bloque de documentación NO es un
 * llamador. Contarla dejaría verde justo el caso que buscamos: la validación
 * que todo el mundo documentó y nadie llamó. `allocation-check` es literalmente
 * eso — su única mención fuera del archivo que la registra es prosa.
 */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const leer = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const ARCHIVOS_SRC = listarTs(join(ROOT, 'src'));
const ARCHIVOS_TESTS = listarTs(join(ROOT, 'tests'));

/**
 * Este mismo archivo, excluido de toda búsqueda de llamadores.
 *
 * Sin esto el chequeo se miente solo: `EXENCIONES` contiene las rutas escritas
 * como texto ('/auth/check-cuit', '/data-points/:id/validate'), así que el
 * buscador las encontraba ACÁ y daba por "llamada" a cualquier ruta que
 * apareciera en el diccionario. Una exención se habría auto-justificado.
 */
const ESTE_ARCHIVO = relative(ROOT, fileURLToPath(import.meta.url)).split('\\').join('/');

// ---------------------------------------------------------------------------
// CHEQUEO 1 — rutas de validación que no llama nadie
// ---------------------------------------------------------------------------

const DIR_RUTAS = 'src/infrastructure/http/routes';

/** Una ruta es "de validación" si su último segmento habla de chequear o validar. */
function esDeValidacion(ruta: string): boolean {
  const ultimo = ruta.split('/').filter(Boolean).pop() ?? '';
  return /(check|validate|validar|verify|verificar)/i.test(ultimo);
}

/**
 * Convierte `/calculation-runs/:id/validate` en una RegExp que reconoce cómo se
 * escribe una llamada de verdad, con el parámetro ya interpolado:
 *
 *     `/calculation-runs/${runId}/validate`
 *     '/calculation-runs/abc-123/validate'
 *
 * El comodín excluye `/` y comillas, así que no se come el resto de la URL ni
 * salta de un literal de cadena al siguiente.
 */
function rutaARegExp(ruta: string): RegExp {
  const partes = ruta
    .split('/')
    .filter(Boolean)
    .map((seg) =>
      seg.startsWith(':') ? '[^/\'"`]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
  return new RegExp('/' + partes.join('/'));
}

interface RutaRegistrada {
  ruta: string;
  archivo: string;
}

function rutasDeValidacion(): RutaRegistrada[] {
  const salida: RutaRegistrada[] = [];
  for (const archivo of ARCHIVOS_SRC.filter((f) => f.startsWith(DIR_RUTAS))) {
    const codigo = sinComentarios(leer(archivo));
    for (const m of codigo.matchAll(/app\.(get|post|put|patch|delete)\s*\(\s*'([^']+)'/g)) {
      if (esDeValidacion(m[2])) salida.push({ ruta: m[2], archivo });
    }
  }
  return salida;
}

/** Archivos que nombran esta ruta, sin contar el que la registra. */
function llamadoresDe(r: RutaRegistrada): string[] {
  const patron = rutaARegExp(r.ruta);
  return [...ARCHIVOS_SRC, ...ARCHIVOS_TESTS]
    .filter((f) => f !== r.archivo && f !== ESTE_ARCHIVO)
    .filter((f) => patron.test(sinComentarios(leer(f))));
}

// ---------------------------------------------------------------------------
// CHEQUEO 2 — módulos de dominio que no ejecuta el producto
// ---------------------------------------------------------------------------

/**
 * Resuelve un especificador de import a una ruta real del repositorio.
 *
 * Hay que RESOLVER, no comparar cadenas. El mismo módulo se importa como
 * `@/domain/value-objects/money.js`, como `../value-objects/money.js` y como
 * `../../domain/value-objects/money.js`. Buscar el texto
 * "domain/value-objects/money.js" encuentra 1 de esos 5 importadores y declara
 * muerto un módulo que usa medio motor. (Pasó mientras se escribía este
 * archivo: la primera versión daba `percentage.ts` por huérfano y no lo es.)
 */
function resolverImport(spec: string, desde: string): string | null {
  let destino: string;
  if (spec.startsWith('@/')) destino = join(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) destino = resolve(join(ROOT, dirname(desde)), spec);
  else return null; // paquete de node_modules, no es código nuestro
  return relative(ROOT, destino).split('\\').join('/').replace(/\.js$/, '.ts');
}

function importesDe(archivo: string): string[] {
  const codigo = sinComentarios(leer(archivo));
  const specs = [...codigo.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return specs.map((s) => resolverImport(s, archivo)).filter((x): x is string => x !== null);
}

/** Módulos de `src/domain/` que ningún archivo de `src/` importa. */
function dominioSinLlamadores(): string[] {
  const importadosPorSrc = new Set<string>();
  for (const archivo of ARCHIVOS_SRC) {
    for (const destino of importesDe(archivo)) {
      if (destino !== archivo) importadosPorSrc.add(destino);
    }
  }
  return ARCHIVOS_SRC.filter((f) => f.startsWith('src/domain/')).filter(
    (f) => !importadosPorSrc.has(f),
  );
}

// ---------------------------------------------------------------------------

describe('validaciones construidas y nunca enchufadas', () => {
  it('toda ruta de validación registrada tiene al menos un llamador, o su exención', () => {
    const huerfanas = rutasDeValidacion()
      .filter((r) => !EXENCIONES[r.ruta])
      .filter((r) => llamadoresDe(r).length === 0);

    // Si esto se pone rojo: o la ruta se llama desde donde corresponde, o se
    // borra, o su exención va en EXENCIONES con el motivo escrito. No hay
    // cuarta opción — el silencio es exactamente lo que dejó a
    // `allocation-check` devolviéndole el mensaje correcto a nadie.
    expect(
      huerfanas.map((r) => `${r.ruta} (${r.archivo})`),
      'Rutas de validación que no llama nadie y no están exentas',
    ).toEqual([]);
  });

  it('todo módulo de src/domain/ lo importa alguien de src/, o está exento', () => {
    const huerfanos = dominioSinLlamadores().filter((f) => !EXENCIONES[f]);

    // Un módulo de dominio que solo importa su test es doctrina codificada que
    // el producto NO ejecuta: los tests pasan en verde y el usuario no recibe
    // nada. Es el caso `desperdicio.ts`, y no es el único.
    expect(huerfanos, 'Módulos de dominio que solo existen para sus tests').toEqual([]);
  });

  it('las exenciones apuntan a cosas que existen', () => {
    // Una exención colgada de una ruta ya borrada es ruido, y el ruido termina
    // tapando una exención real. Mismo criterio que los "fantasmas" de
    // rls-coverage.test.ts.
    const rutas = new Set(rutasDeValidacion().map((r) => r.ruta));
    const modulos = new Set(ARCHIVOS_SRC.filter((f) => f.startsWith('src/domain/')));
    const fantasmas = Object.keys(EXENCIONES).filter((k) => !rutas.has(k) && !modulos.has(k));

    expect(fantasmas, `Exenciones de cosas inexistentes: ${fantasmas.join(', ')}`).toEqual([]);
  });

  it('ninguna exención cubre algo que en realidad sí se llama', () => {
    // Una exención de más miente sobre el estado del código: afirma "esto está
    // desconectado a propósito" sobre algo que funciona perfectamente.
    const conectadasIgual = rutasDeValidacion()
      .filter((r) => EXENCIONES[r.ruta])
      .filter((r) => llamadoresDe(r).length > 0)
      .map((r) => r.ruta);

    expect(
      conectadasIgual,
      `Rutas exentas que igual tienen llamador: ${conectadasIgual.join(', ')}`,
    ).toEqual([]);
  });

  it('cada exención trae un motivo, no un placeholder', () => {
    const flojas = Object.entries(EXENCIONES)
      .filter(([, motivo]) => motivo.trim().length < 40)
      .map(([k]) => k);

    expect(flojas, `Exenciones sin explicación real: ${flojas.join(', ')}`).toEqual([]);
  });
});
