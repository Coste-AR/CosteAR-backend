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

/**
 * Trocea una nota Markdown respetando su estructura: un chunk por sección
 * de nivel 2/3, más un chunk inicial para el texto que cuelga directo del H1
 * (si lo hay). El título de la nota (H1, o el nombre de archivo si no hay H1)
 * se propaga a todos los chunks para dar contexto.
 *
 * Decisiones de diseño intencionales (no son descuidos):
 * - Solo el primer H1 se usa como título de la nota. Cualquier `#` adicional
 *   se descarta silenciosamente: no se trata como contenido ni genera una
 *   sección nueva.
 * - Headings de nivel 4 o más profundo (`####`, etc.) no generan una nueva
 *   sección. El spec solo pide trocear por H2/H3, así que quedan como
 *   contenido plano de la sección actual.
 */
export function chunkMarkdown(filePath: string, rawContent: string): MarkdownChunk[] {
  const lines = rawContent.split(/\r?\n/);

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
    : basename(filePath, extname(filePath));

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
