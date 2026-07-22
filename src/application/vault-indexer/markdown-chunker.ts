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

/**
 * Trocea una nota Markdown respetando su estructura: un chunk por sección
 * de nivel 2/3, más un chunk inicial para el texto que cuelga directo del H1
 * (si lo hay). El título de la nota (H1, o el nombre de archivo si no hay H1)
 * se propaga a todos los chunks para dar contexto.
 */
export function chunkMarkdown(filePath: string, rawContent: string): MarkdownChunk[] {
  const lines = rawContent.split(/\r?\n/);

  const h1Match = lines.find((l) => H1_RE.test(l));
  const sourceTitle = h1Match
    ? h1Match.replace(/^#\s+/, '').trim()
    : basename(filePath, extname(filePath));

  type Section = { headingPath: string | null; lines: string[] };
  const sections: Section[] = [{ headingPath: null, lines: [] }];
  const stack: string[] = [];

  for (const line of lines) {
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
    sections.push({ headingPath: stack.join(' > '), lines: [] });
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
