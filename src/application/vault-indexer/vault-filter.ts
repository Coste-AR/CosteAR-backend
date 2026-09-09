import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

/**
 * Directorios que nunca se indexan, cualquiera sea el `.vaultignore`. Son
 * plomería de la bóveda (Obsidian, git, papelera), no contenido.
 */
export const IGNORED_DIRS = new Set(['.obsidian', '.trash', '.git']);

/**
 * Filtro de qué notas `.md` de la bóveda entran al índice del RAG.
 *
 * Dos mecanismos, ambos opcionales y aditivos sobre el comportamiento anterior
 * (indexar toda `.md` salvo el README de la raíz y los `IGNORED_DIRS`):
 *
 *  1. **`.vaultignore`** en la raíz del vault — globs estilo `.gitignore`. Sirve
 *     para sacar carpetas enteras que son proyecto y no metodología
 *     (`interno/`, `Reportes_Nocturnos/`).
 *  2. **Frontmatter `index: false`** en una nota puntual — la excluye aunque no
 *     matchee ningún glob.
 *
 * El subconjunto de sintaxis de `.gitignore` soportado es el que efectivamente
 * usamos: comentarios (`#`), líneas en blanco, `dir/`, `*.ext`, `a/b/x.md`,
 * `**` entre segmentos, y anclado a la raíz cuando el patrón contiene un `/`
 * que no sea el final. **No** se soporta negación (`!`) ni clases de caracteres
 * (`[a-z]`): si alguna vez hacen falta, se agregan acá con su test.
 */
export interface VaultFilter {
  /** true si la ruta relativa POSIX (ej. `"interno/spec/x.md"`) debe excluirse. */
  isIgnoredPath(relPath: string): boolean;
}

/** Filtro que no excluye nada — el comportamiento sin `.vaultignore`. */
export const ALLOW_ALL: VaultFilter = { isIgnoredPath: () => false };

/**
 * Carga el `.vaultignore` de la raíz del vault. Si no existe o está vacío,
 * devuelve `ALLOW_ALL` (comportamiento anterior).
 */
export async function loadVaultignore(vaultRoot: string): Promise<VaultFilter> {
  let content: string;
  try {
    content = await readFile(join(vaultRoot, '.vaultignore'), 'utf-8');
  } catch {
    return ALLOW_ALL;
  }
  return compileVaultignore(content);
}

/** Compila el contenido de un `.vaultignore` a un `VaultFilter`. */
export function compileVaultignore(content: string): VaultFilter {
  const rules = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map(parseRule);

  if (rules.length === 0) return ALLOW_ALL;

  return {
    isIgnoredPath(relPath) {
      const posix = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
      return rules.some((rule) => rule(posix));
    },
  };
}

type Rule = (posixPath: string) => boolean;

function parseRule(line: string): Rule {
  const dirOnly = line.endsWith('/');
  const raw = dirOnly ? line.slice(0, -1) : line;
  // gitignore: un patrón con `/` (que no sea el separador final) se ancla a la
  // raíz del vault. `interno/` NO se ancla → matchea a cualquier profundidad.
  const rootAnchored = raw.startsWith('/') || raw.includes('/');
  const pattern = raw.replace(/^\//, '');
  const re = globToRegExp(pattern);

  return (posixPath) => {
    const targets = dirOnly ? directoryPrefixes(posixPath) : [posixPath];
    return targets.some((target) => {
      if (re.test(target)) return true;
      if (rootAnchored) return false;
      // Patrón no anclado: matchea también en cualquier borde de segmento.
      const segs = target.split('/');
      for (let i = 1; i < segs.length; i++) {
        if (re.test(segs.slice(i).join('/'))) return true;
      }
      return false;
    });
  };
}

/** `a/b/c.md` → `["a", "a/b"]` (los directorios que contienen al archivo). */
function directoryPrefixes(posixPath: string): string[] {
  const parts = posixPath.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

function globToRegExp(pattern: string): RegExp {
  // Se usan marcadores intermedios (`@@...@@`, sin metacaracteres y ausentes de
  // cualquier glob real) para no pisar los `?` que introduce la traducción del
  // globstar cuando después se traducen los `?` del propio patrón.
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '@@GS_SLASH@@') // globstar + separador
    .replace(/\*\*/g, '@@GS@@')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/@@GS_SLASH@@/g, '(?:.*/)?') // cero o más directorios
    .replace(/@@GS@@/g, '.*');
  return new RegExp(`^${body}$`);
}

/**
 * Reusa el patrón de `markdown-chunker.ts`: el frontmatter es el bloque
 * `---\n...\n---` al inicio del archivo. Devuelve true si trae `index: false`.
 */
export function isFrontmatterIndexFalse(rawContent: string): boolean {
  const lines = rawContent.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return false;
  const closingIndex = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closingIndex === -1) return false;
  return lines
    .slice(1, closingIndex)
    .some((l) => /^index:\s*false\s*$/i.test(l.trim()));
}

/**
 * Lista las notas `.md` de un vault que SÍ deben indexarse. Aplica, en orden:
 *  - `IGNORED_DIRS` (plomería),
 *  - el `README.md` de la raíz (instrucciones para el equipo, no conocimiento),
 *  - las reglas del `.vaultignore` de la raíz (si existe),
 *  - el frontmatter `index: false` de cada nota.
 *
 * Devuelve rutas absolutas, igual que antes. Es la fuente de verdad de "qué se
 * indexa": el `vault-indexer-service` la consume y no reimplementa el walk.
 */
export async function listMarkdownFiles(rootDir: string): Promise<string[]> {
  const filter = await loadVaultignore(rootDir);
  const result: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      if (dir === rootDir && entry.name.toLowerCase() === 'readme.md') continue;

      const relPath = relative(rootDir, full).replace(/\\/g, '/');
      if (filter.isIgnoredPath(relPath)) continue;

      const raw = await readFile(full, 'utf-8');
      if (isFrontmatterIndexFalse(raw)) continue;

      result.push(full);
    }
  }

  await walk(rootDir);
  return result;
}

/** Alias explícito para los tests — misma función, nombre que deja claro el intent. */
export const listMarkdownFilesForTest = listMarkdownFiles;
