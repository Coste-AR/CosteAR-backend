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
// H2..H6 abren sección. Antes era `{2,3}` y todo lo más profundo se aplanaba
// como contenido; ahora los niveles 4-6 también aportan al `headingPath` para
// no perder la ubicación de un fragmento (ej. "CIP > Prorrateo > Base horas
// máquina") — clave para el retrieval.
const HEADING_RE = /^(#{2,6})\s+(.+)$/;
const FENCE_RE = /^```/;
const FRONTMATTER_TITLE_RE = /^title:\s*(.*)$/;

/**
 * Techo de tamaño de un chunk, en caracteres. ~800 tokens ≈ 3200 caracteres
 * (heurística ~4 chars/token; no hay tokenizador en el stack). Una sección más
 * grande se subdivide recursivamente: por párrafos, y si un párrafo solo ya
 * supera el techo, por oraciones.
 */
const MAX_CHUNK_CHARS = 3200;

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

/** Divide un texto en párrafos (separados por una o más líneas en blanco). */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Divide un párrafo largo en oraciones, conservando el signo de puntuación. */
function splitSentences(paragraph: string): string[] {
  const parts = paragraph.match(/[^.!?…]+[.!?…]+(?:["'”’)\]]+)?|\S[^.!?…]*$/g);
  return (parts ?? [paragraph]).map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Empaqueta las piezas (párrafos u oraciones) en grupos que no superen el
 * techo. Una pieza que sola ya lo supera se subdivide por oraciones; si aún
 * así una oración sola lo supera, se deja entera (no se corta una oración).
 */
function packPieces(pieces: string[]): string[] {
  const groups: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) groups.push(current.trim());
    current = '';
  };

  for (const piece of pieces) {
    if (piece.length > MAX_CHUNK_CHARS) {
      flush();
      const sentences = splitSentences(piece);
      if (sentences.length > 1) {
        for (const g of packPieces(sentences)) groups.push(g);
      } else {
        groups.push(piece); // una sola oración enorme: no se parte
      }
      continue;
    }
    if (current && current.length + 2 + piece.length > MAX_CHUNK_CHARS) {
      flush();
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  flush();
  return groups;
}

/**
 * Trocea el contenido de una sección. Si entra en el techo, un solo trozo (el
 * comportamiento de siempre). Si no, varios trozos con **solape de un párrafo**
 * entre trozos contiguos de la misma sección: el último párrafo de un trozo se
 * repite al inicio del siguiente para no perder el hilo en el corte.
 */
function splitSectionContent(content: string): string[] {
  if (content.length <= MAX_CHUNK_CHARS) return [content];

  const paragraphs = splitParagraphs(content);
  if (paragraphs.length <= 1) return packPieces([content]);

  const groups = packPieces(paragraphs);
  if (groups.length <= 1) return groups;

  const withOverlap: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    if (i === 0) {
      withOverlap.push(groups[i]!);
      continue;
    }
    const prevParas = splitParagraphs(groups[i - 1]!);
    const overlap = prevParas[prevParas.length - 1] ?? '';
    withOverlap.push(overlap ? `${overlap}\n\n${groups[i]!}` : groups[i]!);
  }
  return withOverlap;
}

/**
 * Trocea una nota Markdown respetando su estructura: un chunk por sección de
 * nivel 2-6, más un chunk inicial para el texto que cuelga directo del H1 (si
 * lo hay). Una sección que supera `MAX_CHUNK_CHARS` se subdivide por párrafos
 * (y, si hace falta, por oraciones), con solape de un párrafo entre trozos
 * contiguos. El título de la nota se propaga a todos los chunks, con esta
 * prioridad: H1 de la nota > `title:` del frontmatter > nombre de archivo.
 *
 * Decisiones de diseño intencionales (no son descuidos):
 * - Solo el primer H1 se usa como título de la nota. Cualquier `#` adicional
 *   se descarta silenciosamente: no se trata como contenido ni genera una
 *   sección nueva.
 * - Los niveles 4-6 (`####`, etc.) SÍ generan sección y aportan al
 *   `headingPath`; niveles más profundos no existen en Markdown.
 * - El frontmatter YAML se descarta antes de trocear: nunca aparece en el
 *   contenido de ningún chunk.
 * - Dentro de un bloque de código, ninguna línea se interpreta como heading.
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

    const level = match[1]!.length; // 2..6
    const text = match[2]!.trim();
    stack[level - 2] = text;
    stack.length = level - 1;
    sections.push({ headingPath: stack.filter(Boolean).join(' > '), lines: [] });
  }

  const chunks: MarkdownChunk[] = [];
  let chunkIndex = 0;
  for (const section of sections) {
    const content = section.lines.join('\n').trim();
    if (!content) continue;
    for (const piece of splitSectionContent(content)) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      const contentHash = createHash('sha256')
        .update(`${section.headingPath ?? ''}\n${trimmed}`)
        .digest('hex');
      chunks.push({
        sourceTitle,
        headingPath: section.headingPath,
        content: trimmed,
        chunkIndex,
        contentHash,
      });
      chunkIndex++;
    }
  }
  return chunks;
}
