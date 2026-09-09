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

  it('descarta el frontmatter YAML: no aparece en ningún chunk', () => {
    const raw = [
      '---',
      'title: "Clase 1 — Introducción a la contabilidad de gestión"',
      'tags: [costear, clasesmirta]',
      'fecha_clase: 2026-06-29',
      '---',
      '',
      '### Contabilidad Tradicional vs. Contabilidad de Gestión',
      '',
      'Texto de la sección.',
      '',
    ].join('\n');

    const chunks = chunkMarkdown('1. Introducción.md', raw);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('Texto de la sección.');
    expect(chunks[0]?.content).not.toContain('title:');
    expect(chunks[0]?.content).not.toContain('tags:');
    expect(chunks[0]?.content).not.toContain('---');
  });

  it('usa el title del frontmatter como sourceTitle cuando no hay H1', () => {
    const raw = [
      '---',
      'title: "Clase 10 — Capacidad de producción"',
      'materia: "Costos I"',
      '---',
      '',
      '### Presencia en fábrica',
      '',
      'Texto.',
      '',
    ].join('\n');

    const chunks = chunkMarkdown('10. Capacidad.md', raw);

    expect(chunks[0]?.sourceTitle).toBe('Clase 10 — Capacidad de producción');
  });

  it('el H1 sigue teniendo prioridad sobre el title del frontmatter', () => {
    const raw = [
      '---',
      'title: "Título del frontmatter"',
      '---',
      '',
      '# Título real de la nota',
      '',
      'Texto.',
      '',
    ].join('\n');

    const chunks = chunkMarkdown('nota.md', raw);

    expect(chunks[0]?.sourceTitle).toBe('Título real de la nota');
  });

  it('nota real con frontmatter y solo headings de nivel 3 (sin H2): headingPath sin separador colgante', () => {
    const raw = [
      '---',
      'title: "Clase real"',
      '---',
      '',
      '### Primer tema',
      '',
      'Contenido del primer tema.',
      '',
      '### Segundo tema',
      '',
      'Contenido del segundo tema.',
      '',
    ].join('\n');

    const chunks = chunkMarkdown('clase.md', raw);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ headingPath: 'Primer tema', content: 'Contenido del primer tema.' });
    expect(chunks[1]).toMatchObject({ headingPath: 'Segundo tema', content: 'Contenido del segundo tema.' });
  });

  describe('troceo recursivo (F1-04)', () => {
    const parrafo = (n: number) => `Párrafo ${n}. ` + 'palabra '.repeat(60).trim() + '.';

    it('una sección corta sigue siendo un solo chunk (sin cambios)', () => {
      const raw = '# X\n\n## Sección\n\n' + [parrafo(1), parrafo(2)].join('\n\n') + '\n';
      const chunks = chunkMarkdown('x.md', raw);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.headingPath).toBe('Sección');
    });

    it('una sección larga se parte en varios chunks, todos con el mismo headingPath', () => {
      const parrafos = Array.from({ length: 12 }, (_, i) => parrafo(i + 1));
      const raw = '# X\n\n## Sección grande\n\n' + parrafos.join('\n\n') + '\n';
      const chunks = chunkMarkdown('x.md', raw);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((c) => c.headingPath === 'Sección grande')).toBe(true);
      // chunkIndex correlativo global
      expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
      // ningún chunk supera holgadamente el techo (~3200 chars) — se permite
      // un margen por el párrafo de solape.
      expect(chunks.every((c) => c.content.length <= 3200 + 700)).toBe(true);
    });

    it('los chunks contiguos de una sección comparten el último párrafo (solape)', () => {
      const parrafos = Array.from({ length: 12 }, (_, i) => parrafo(i + 1));
      const raw = '# X\n\n## Sección\n\n' + parrafos.join('\n\n') + '\n';
      const chunks = chunkMarkdown('x.md', raw);

      expect(chunks.length).toBeGreaterThan(1);
      for (let i = 1; i < chunks.length; i++) {
        const prevParas = chunks[i - 1]!.content.split(/\n\s*\n/);
        const lastOfPrev = prevParas[prevParas.length - 1]!.trim();
        expect(chunks[i]!.content.startsWith(lastOfPrev)).toBe(true);
      }
    });

    it('un solo párrafo enorme se parte por oraciones', () => {
      const oraciones = Array.from({ length: 40 }, (_, i) => `Esta es la oración número ${i + 1} y tiene bastante texto de relleno para ocupar lugar.`);
      const raw = '# X\n\n## Sección\n\n' + oraciones.join(' ') + '\n';
      const chunks = chunkMarkdown('x.md', raw);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((c) => c.headingPath === 'Sección')).toBe(true);
      // no se corta a mitad de oración: cada chunk termina en signo de puntería
      expect(chunks.every((c) => /[.!?…]["'”’)\]]*$/.test(c.content.trim()))).toBe(true);
    });

    it('los headings de nivel 4-6 aportan al headingPath en vez de aplanarse', () => {
      const raw = [
        '# Nota',
        '',
        '## CIP',
        '',
        '### Prorrateo',
        '',
        '#### Base horas máquina',
        '',
        'El prorrateo usa las horas máquina de cada departamento.',
        '',
        '##### Detalle',
        '',
        'Un detalle todavía más fino.',
        '',
      ].join('\n');

      const chunks = chunkMarkdown('nota.md', raw);

      const base = chunks.find((c) => c.content.startsWith('El prorrateo usa'));
      expect(base?.headingPath).toBe('CIP > Prorrateo > Base horas máquina');
      const detalle = chunks.find((c) => c.content.startsWith('Un detalle'));
      expect(detalle?.headingPath).toBe('CIP > Prorrateo > Base horas máquina > Detalle');
    });

    it('un ### después de un #### vuelve a nivel 3 (el stack se recorta)', () => {
      const raw = [
        '# Nota',
        '',
        '## A',
        '',
        '### A1',
        '',
        '#### A1a',
        '',
        'contenido a1a',
        '',
        '### A2',
        '',
        'contenido a2',
        '',
      ].join('\n');

      const chunks = chunkMarkdown('nota.md', raw);
      expect(chunks.find((c) => c.content === 'contenido a1a')?.headingPath).toBe('A > A1 > A1a');
      expect(chunks.find((c) => c.content === 'contenido a2')?.headingPath).toBe('A > A2');
    });
  });
});
