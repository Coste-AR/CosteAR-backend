import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

export interface MarkdownChunk {
  sourceTitle: string;
  headingPath: string | null;
  content: string;
  chunkIndex: number;
  contentHash: string;
}

const H1_RE = /^#\s+.+$/;
const HEADING_RE = /^(#{2,3})\s+(.+)$/;
const FENCE_RE = /^```/;
const FRONTMATTER_TITLE_RE = /^title:\s*(.*)$/;

/**
 * Separa el frontmatter YAML (bloque `---\n...\n---` al inicio del archivo,
 * como el que exportan las transcripciones de Granola) del cuerpo real de la
 * nota. El frontmatter nunca debe indexarse como contenido — es metadata, no
 * prosa. Si trae un campo `title:`, se devuelve para usarlo como sourceTitle
 * de respaldo cuando la nota no tiene H1.
 */
function extractFrontmatter(rawContent: string): { title: string | null; body: string } {
  const lines = rawContent.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return { title: null, body: rawContent };
  }
  const closingIndex = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closingIndex === -1) {
    return { title: null, body: rawContent };
  }
  const frontmatterLines = lines.slice(1, closingIndex);
  const titleLine = frontmatterLines.find((l) => FRONTMATTER_TITLE_RE.test(l));
  const title = titleLine
    ? (FRONTMATTER_TITLE_RE.exec(titleLine)![1] ?? '').trim().replace(/^"(.*)"$/, '$1')
    : null;
  const body = lines.slice(closingIndex + 1).join('\n');
  return { title: title || null, body };
}

/**
 * Trocea una nota Markdown respetando su estructura: un chunk por sección
 * de nivel 2/3, más un chunk inicial para el texto que cuelga directo del H1
 * (si lo hay). El título de la nota se propaga a todos los chunks para dar
 * contexto, con esta prioridad: H1 de la nota > `title:` del frontmatter >
 * nombre de archivo.
 *
 * Decisiones de diseño intencionales (no son descuidos):
 * - Solo el primer H1 se usa como título de la nota. Cualquier `#` adicional
 *   se descarta silenciosamente: no se trata como contenido ni genera una
 *   sección nueva.
 * - Headings de nivel 4 o más profundo (`####`, etc.) no generan una nueva
 *   sección. El spec solo pide trocear por H2/H3, así que quedan como
 *   contenido plano de la sección actual.
 * - El frontmatter YAML se descarta antes de trocear: nunca aparece en el
 *   contenido de ningún chunk.
 */
export function chunkMarkdown(filePath: string, rawContent: string): MarkdownChunk[] {
  const { title: frontmatterTitle, body } = extractFrontmatter(rawContent);
  const lines = body.split(/\r?\n/);

  // Búsqueda del H1 también debe ser fence-aware: una línea "# ..." dentro
  // de un bloque de código no debe robarle el título a la nota.
  let h1Match: string | undefined;
  let scanningFence = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      scanningFence = !scanningFence;
      continue;
    }
    if (!scanningFence && H1_RE.test(line)) {
      h1Match = line;
      break;
    }
  }
  const sourceTitle = h1Match
    ? h1Match.replace(/^#\s+/, '').trim()
    : frontmatterTitle ?? basename(filePath, extname(filePath));

  type Section = { headingPath: string | null; lines: string[] };
  const sections: Section[] = [{ headingPath: null, lines: [] }];
  const stack: string[] = [];
  let insideFence = false;

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      insideFence = !insideFence;
      sections[sections.length - 1]!.lines.push(line);
      continue;
    }

    // Dentro de un bloque de código, ninguna línea se interpreta como
    // heading (ni H1 ni H2/H3) — se trata como contenido plano. Evita que
    // fórmulas o ejemplos de sintaxis Markdown documentados en un fence
    // (p. ej. una línea "## Ejemplo" dentro de ```) se parseen como sección real.
    if (insideFence) {
      sections[sections.length - 1]!.lines.push(line);
      continue;
    }

    if (H1_RE.test(line)) continue; // ya usado como sourceTitle

    const match = HEADING_RE.exec(line);
    if (!match) {
      sections[sections.length - 1]!.lines.push(line);
      continue;
    }

    const level = match[1]!.length; // 2 o 3
    const text = match[2]!.trim();
    if (level === 2) {
      stack[0] = text;
      stack.length = 1;
    } else {
      stack[1] = text;
      stack.length = 2;
    }
    sections.push({ headingPath: stack.filter(Boolean).join(' > '), lines: [] });
  }

  const chunks: MarkdownChunk[] = [];
  let chunkIndex = 0;
  for (const section of sections) {
    const content = section.lines.join('\n').trim();
    if (!content) continue;
    const contentHash = createHash('sha256')
      .update(`${section.headingPath ?? ''}\n${content}`)
      .digest('hex');
    chunks.push({ sourceTitle, headingPath: section.headingPath, content, chunkIndex, contentHash });
    chunkIndex++;
  }
  return chunks;
}
