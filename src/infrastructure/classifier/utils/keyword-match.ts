/**
 * Matcheo de keywords del clasificador con LÍMITE DE PALABRA en español.
 *
 * ── EL DEFECTO QUE ESTO CORRIGE ────────────────────────────────────────────
 * Todas las capas de keywords hacían `lower.includes(kw)`. Un `includes` no
 * sabe dónde empieza una palabra, así que cada keyword corta también adentro de
 * otras palabras que no tienen nada que ver:
 *
 *   'raso'  (TEXTIL, materia prima)  →  matcheaba «at·RASO·»
 *   'sal'   (GASTRONOMIA, m. prima)  →  matcheaba «SAL·do», «SAL·ón», «SAL·ario»
 *   'API'   (SERVICIOS, m. prima)    →  matcheaba «c·API·tal»
 *   'pieza' (MANUFACTURA, m. prima)  →  matcheaba «lim·PIEZA·»
 *
 * Cada falso match suma un punto a la sección equivocada en el conteo de
 * layer4, y ese conteo es lo que decide MP vs. CIP vs. gasto. Una factura de
 * "servicio de limpieza" sumaba Materia Prima; un resumen bancario con "saldo"
 * sumaba Materia Prima. Es transversal a todos los rubros, no de uno.
 *
 * Ya había parches puntuales por este mismo defecto: el perfil AVICULTURA tuvo
 * que SACAR la keyword 'ración' porque estaba adentro de "repa·ración". Eso es
 * el síntoma — la regla de matcheo era el problema.
 *
 * ── LA REGLA ───────────────────────────────────────────────────────────────
 * Asimétrica a propósito, y esa asimetría es lo importante:
 *
 *  1. Al PRINCIPIO, frontera estricta: la keyword no puede empezar en medio de
 *     una palabra. Es lo que mata «atraso», «capital» y «limpieza».
 *
 *  2. Al FINAL, se admite el sufijo de PLURAL ('s' / 'es') y nada más. El
 *     `includes` regalaba concordancia de número —'vacuna' matcheaba "vacunas",
 *     'jaula' matcheaba "jaulas", 'material' matcheaba "materiales"— y las
 *     listas están escritas contando con eso. Una frontera estricta de los dos
 *     lados rompería decenas de keywords legítimas de golpe. Admitir SOLO el
 *     plural conserva eso y sigue matando «SAL·do» ("do" no es plural),
 *     «SAL·ón» y «SAL·ario».
 *
 * "Letra" es `\p{L}` (Unicode), no `[a-z]`: `\b` de JavaScript está definido
 * sobre `[A-Za-z0-9_]`, así que trata a la 'í' de "energía" y a la 'ñ' como
 * separadores — con `\b` la keyword 'útiles de oficina' no habría matcheado
 * NUNCA (exige una letra ASCII antes de la 'ú'). Los dígitos NO cuentan como
 * letra a propósito: "12000kwh" tiene que seguir matcheando 'kwh'.
 *
 * Las keywords que no empiezan/terminan en letra no llevan la frontera de ese
 * lado, porque el carácter no-letra ya la provee y exigirla rompería el dato:
 * ' kg' (empieza con espacio, y viene después de un número) y 'alq.' (termina
 * en punto) son keywords reales de los perfiles.
 *
 * ── LO QUE ESTA REGLA NO HACE ──────────────────────────────────────────────
 * No plega acentos ni maneja otra morfología que el plural: 'reparación' sigue
 * sin matchear "reparaciones" (igual que antes — por eso las listas escriben
 * las dos formas, con y sin tilde). Mantenerlo así es deliberado: cada relajación
 * extra vuelve a abrir la puerta a los falsos matches que esto viene a cerrar.
 */

/** Una letra en cualquier idioma — incluye á/é/í/ó/ú/ü/ñ. Sin dígitos (ver arriba). */
const LETTER_RE = /\p{L}/u;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Las listas de keywords son constantes de módulo y se recorren una vez por
 * documento: sin caché se recompilarían cientos de RegExp por clasificación.
 */
const regexCache = new Map<string, RegExp>();

function keywordRegex(keyword: string): RegExp {
  const cached = regexCache.get(keyword);
  if (cached) return cached;

  const kw = keyword.toLowerCase();
  const startsWithLetter = LETTER_RE.test(kw.charAt(0));
  const endsWithLetter   = LETTER_RE.test(kw.charAt(kw.length - 1));

  const re = new RegExp(
    (startsWithLetter ? '(?<!\\p{L})' : '') +
    escapeRegExp(kw) +
    // El orden 'es' antes de 's' no cambia el resultado (el grupo es opcional y
    // hay backtracking), pero deja el intento más largo primero.
    (endsWithLetter ? '(?:es|s)?(?!\\p{L})' : ''),
    'u',
  );
  regexCache.set(keyword, re);
  return re;
}

/**
 * ¿Aparece `keyword` en `haystack` como palabra (admitiendo plural)?
 *
 * `haystack` puede venir en cualquier caso: se compara en minúsculas, igual que
 * hacían los `lower.includes(kw.toLowerCase())` que esto reemplaza.
 */
export function keywordMatches(haystack: string, keyword: string): boolean {
  if (!keyword) return false;
  return keywordRegex(keyword).test(haystack.toLowerCase());
}

/** Las keywords de `keywords` que matchean en `haystack`, en el orden de la lista. */
export function matchKeywords(haystack: string, keywords: readonly string[]): string[] {
  const lower = haystack.toLowerCase();
  return keywords.filter((kw) => kw !== '' && keywordRegex(kw).test(lower));
}

/** Cuántas keywords de `keywords` matchean. Atajo de `matchKeywords(...).length`. */
export function countKeywords(haystack: string, keywords: readonly string[]): number {
  return matchKeywords(haystack, keywords).length;
}

/** La primera keyword que matchea, o `null`. El orden de la lista es la prioridad. */
export function firstKeywordMatch(haystack: string, keywords: readonly string[]): string | null {
  const lower = haystack.toLowerCase();
  for (const kw of keywords) {
    if (kw !== '' && keywordRegex(kw).test(lower)) return kw;
  }
  return null;
}
