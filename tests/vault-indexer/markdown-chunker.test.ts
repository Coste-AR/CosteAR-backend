import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from '@/application/vault-indexer/markdown-chunker.js';

describe('chunkMarkdown', () => {
  it('genera un chunk por sección de nivel 2, con headingPath', () => {
    const raw = '# Costeo por Procesos\n\nIntro general.\n\n## Método FIFO\n\nTexto FIFO.\n\n## Método PEPS\n\nTexto PEPS.\n';
    const chunks = chunkMarkdown('Costeo/procesos.md', raw);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ sourceTitle: 'Costeo por Procesos', headingPath: null, content: 'Intro general.', chunkIndex: 0 });
    expect(chunks[1]).toMatchObject({ sourceTitle: 'Costeo por Procesos', headingPath: 'Método FIFO', content: 'Texto FIFO.', chunkIndex: 1 });
    expect(chunks[2]).toMatchObject({ sourceTitle: 'Costeo por Procesos', headingPath: 'Método PEPS', content: 'Texto PEPS.', chunkIndex: 2 });
  });

  it('anida headings de nivel 3 bajo el nivel 2 actual', () => {
    const raw = '# Nota\n\n## Método FIFO\n\n### Ejemplo\n\nUn ejemplo concreto.\n';
    const chunks = chunkMarkdown('nota.md', raw);

    const ejemplo = chunks.find((c) => c.content === 'Un ejemplo concreto.');
    expect(ejemplo?.headingPath).toBe('Método FIFO > Ejemplo');
  });

  it('usa el nombre de archivo como título si no hay H1', () => {
    const raw = 'Contenido sin título.\n';
    const chunks = chunkMarkdown('sin-titulo.md', raw);
    expect(chunks[0]?.sourceTitle).toBe('sin-titulo');
  });

  it('devuelve un array vacío para una nota sin contenido', () => {
    expect(chunkMarkdown('vacia.md', '')).toEqual([]);
    expect(chunkMarkdown('vacia.md', '   \n\n  ')).toEqual([]);
  });

  it('produce el mismo contentHash si el contenido no cambia, y distinto si cambia', () => {
    const a = chunkMarkdown('x.md', '# X\n\n## Sección\n\nTexto original.\n');
    const b = chunkMarkdown('x.md', '# X\n\n## Sección\n\nTexto original.\n');
    const c = chunkMarkdown('x.md', '# X\n\n## Sección\n\nTexto modificado.\n');

    expect(a[0]?.contentHash).toBe(b[0]?.contentHash);
    expect(a[0]?.contentHash).not.toBe(c[0]?.contentHash);
  });

  it('no interpreta headings dentro de un bloque de código como secciones reales', () => {
    const raw = [
      '# Nota',
      '',
      '## Sintaxis Markdown',
      '',
      'Así se documenta un heading de nivel 2:',
      '',
      '```',
      '## Ejemplo',
      'Esto no es una sección real.',
      '```',
      '',
      'Texto después del bloque.',
      '',
    ].join('\n');

    const chunks = chunkMarkdown('sintaxis.md', raw);

    // Un único chunk para "Sintaxis Markdown": el contenido del fence
    // (incluida la línea "## Ejemplo") queda dentro de ese mismo chunk,
    // no genera una sección "Ejemplo" separada.
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toBe('Sintaxis Markdown');
    expect(chunks[0]?.content).toContain('## Ejemplo');
    expect(chunks[0]?.content).toContain('Esto no es una sección real.');
    expect(chunks[0]?.content).toContain('Texto después del bloque.');
    expect(chunks.some((c) => c.headingPath === 'Ejemplo')).toBe(false);
  });
});
