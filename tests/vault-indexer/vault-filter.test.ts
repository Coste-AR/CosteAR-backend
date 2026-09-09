import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compileVaultignore,
  loadVaultignore,
  isFrontmatterIndexFalse,
  ALLOW_ALL,
  listMarkdownFilesForTest,
} from '@/application/vault-indexer/vault-filter.js';

describe('compileVaultignore', () => {
  it('sin reglas útiles devuelve un filtro que no excluye nada', () => {
    const f = compileVaultignore('# solo comentarios\n\n   \n');
    expect(f.isIgnoredPath('interno/x.md')).toBe(false);
    expect(f).toBe(ALLOW_ALL);
  });

  it('`dir/` excluye cualquier archivo bajo ese directorio en la raíz', () => {
    const f = compileVaultignore('interno/\nReportes_Nocturnos/\n');
    expect(f.isIgnoredPath('interno/spec/handoff.md')).toBe(true);
    expect(f.isIgnoredPath('Reportes_Nocturnos/2026-09-09-Resumen.md')).toBe(true);
    expect(f.isIgnoredPath('conocimiento/catedra/clase-1.md')).toBe(false);
  });

  it('`dir/` sin anclar matchea el directorio a cualquier profundidad', () => {
    const f = compileVaultignore('interno/\n');
    expect(f.isIgnoredPath('conocimiento/interno/nota.md')).toBe(true);
    expect(f.isIgnoredPath('interno.md')).toBe(false); // es un archivo, no el dir
  });

  it('`*.ext` excluye por extensión en cualquier nivel', () => {
    const f = compileVaultignore('*.tmp\n');
    expect(f.isIgnoredPath('borrador.tmp')).toBe(true);
    expect(f.isIgnoredPath('conocimiento/x/borrador.tmp')).toBe(true);
    expect(f.isIgnoredPath('conocimiento/x/nota.md')).toBe(false);
  });

  it('un patrón con `/` se ancla a la raíz del vault', () => {
    const f = compileVaultignore('conocimiento/interno/secreto.md\n');
    expect(f.isIgnoredPath('conocimiento/interno/secreto.md')).toBe(true);
    expect(f.isIgnoredPath('otro/conocimiento/interno/secreto.md')).toBe(false);
  });

  it('soporta `**` entre segmentos', () => {
    const f = compileVaultignore('conocimiento/**/borradores/\n');
    expect(f.isIgnoredPath('conocimiento/catedra/borradores/x.md')).toBe(true);
    expect(f.isIgnoredPath('conocimiento/borradores/x.md')).toBe(true);
    expect(f.isIgnoredPath('conocimiento/catedra/clase-1.md')).toBe(false);
  });

  it('ignora comentarios y líneas en blanco', () => {
    const f = compileVaultignore('# esto es un comentario\n\ninterno/\n  # otro\n');
    expect(f.isIgnoredPath('interno/x.md')).toBe(true);
  });

  it('normaliza separadores de Windows', () => {
    const f = compileVaultignore('interno/\n');
    expect(f.isIgnoredPath('interno\\spec\\x.md')).toBe(true);
  });
});

describe('loadVaultignore', () => {
  it('sin archivo `.vaultignore` devuelve ALLOW_ALL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vault-noignore-'));
    try {
      const f = await loadVaultignore(dir);
      expect(f).toBe(ALLOW_ALL);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('con `.vaultignore` compila sus reglas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vault-ignore-'));
    try {
      await writeFile(join(dir, '.vaultignore'), 'interno/\n');
      const f = await loadVaultignore(dir);
      expect(f.isIgnoredPath('interno/x.md')).toBe(true);
      expect(f.isIgnoredPath('conocimiento/x.md')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('isFrontmatterIndexFalse', () => {
  it('true cuando el frontmatter trae `index: false`', () => {
    expect(isFrontmatterIndexFalse('---\ntitle: X\nindex: false\n---\n\nContenido.')).toBe(true);
    expect(isFrontmatterIndexFalse('---\nindex:false\n---\n')).toBe(true);
    expect(isFrontmatterIndexFalse('---\nINDEX: FALSE\n---\n')).toBe(true);
  });

  it('false sin frontmatter, con `index: true`, o con frontmatter sin cerrar', () => {
    expect(isFrontmatterIndexFalse('# Nota\n\nsin frontmatter')).toBe(false);
    expect(isFrontmatterIndexFalse('---\nindex: true\n---\n')).toBe(false);
    expect(isFrontmatterIndexFalse('---\nindex: false\n(nunca cierra)')).toBe(false);
    expect(isFrontmatterIndexFalse('texto\n---\nindex: false\n---')).toBe(false); // no arranca con ---
  });
});

describe('listMarkdownFilesForTest (integración con el filtro)', () => {
  it('excluye por `.vaultignore`, por `index: false` y el README de la raíz; conserva el resto', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vault-list-'));
    try {
      await writeFile(join(dir, '.vaultignore'), 'interno/\nReportes_Nocturnos/\n');
      await writeFile(join(dir, 'README.md'), '# cómo subir contenido');
      await mkdir(join(dir, 'conocimiento', 'catedra'), { recursive: true });
      await writeFile(join(dir, 'conocimiento', 'catedra', 'clase-1.md'), '# Clase 1');
      await writeFile(
        join(dir, 'conocimiento', 'catedra', 'apunte-privado.md'),
        '---\nindex: false\n---\n\nno indexar',
      );
      await mkdir(join(dir, 'interno', 'spec'), { recursive: true });
      await writeFile(join(dir, 'interno', 'spec', 'handoff.md'), '# handoff devs');
      await mkdir(join(dir, 'Reportes_Nocturnos'), { recursive: true });
      await writeFile(join(dir, 'Reportes_Nocturnos', '2026-09-09.md'), '# reporte');
      await mkdir(join(dir, '.git'), { recursive: true });
      await writeFile(join(dir, '.git', 'config.md'), 'no');

      const files = await listMarkdownFilesForTest(dir);
      const rel = files.map((f) => f.slice(dir.length + 1).replace(/\\/g, '/')).sort();

      expect(rel).toEqual(['conocimiento/catedra/clase-1.md']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
