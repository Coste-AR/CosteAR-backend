import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * El 28/07/2026 la app sirvió tráfico con `audit_logs` inexistente: la
 * migración init había creado nueve tablas y muerto antes de la décima, pero
 * `_prisma_migrations` la daba por aplicada. `migrate deploy` salía 0, /health
 * respondía 200, y las 38 llamadas a recordAudit() tiraban 500.
 *
 * Estos tests fijan las dos propiedades de las que depende el verificador.
 */

function leerSchema(): string {
  return readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
}

function tablasDelSchema(schema: string): string[] {
  return [...new Set([...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1]))];
}

describe('verify-schema: derivación de las tablas esperadas', () => {
  it('todos los modelos tienen @@map — si no, el verificador no los vería', () => {
    const schema = leerSchema();
    const modelos = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];

    const sinMap = modelos.filter(([, , cuerpo]) => !cuerpo.includes('@@map(')).map(([, n]) => n);

    // Un modelo sin @@map cae fuera del chequeo y podría faltar en la base sin
    // que nadie se entere — que es exactamente cómo pasó lo de audit_logs.
    expect(sinMap).toEqual([]);
    expect(modelos.length).toBeGreaterThan(0);
  });

  it('extrae una tabla por modelo, incluida audit_logs', () => {
    const schema = leerSchema();
    const modelos = [...schema.matchAll(/^model\s+\w+\s*\{/gm)];
    const tablas = tablasDelSchema(schema);

    expect(tablas.length).toBe(modelos.length);
    expect(tablas).toContain('audit_logs');
    expect(tablas).toContain('data_entries');
    expect(tablas).toContain('users');
  });

  it('el script existe y es sintácticamente válido', () => {
    // `node --check` no lo ejecuta: solo parsea. No toca la base.
    expect(() =>
      execFileSync(process.execPath, ['--check', join(ROOT, 'scripts', 'verify-schema.mjs')]),
    ).not.toThrow();
  });
});

describe('verify-schema: detección de faltantes', () => {
  /** Misma lógica de diff que usa el script, aislada para poder ejercitarla. */
  function faltantes(esperadas: string[], enLaBase: string[]): string[] {
    const existentes = new Set(enLaBase);
    return esperadas.filter((t) => !existentes.has(t));
  }

  it('detecta el caso real: una sola tabla faltante al final de la migración', () => {
    const esperadas = ['users', 'companies', 'macro_snapshots', 'alerts', 'audit_logs'];
    const enLaBase = ['users', 'companies', 'macro_snapshots', 'alerts']; // init murió antes de la última

    expect(faltantes(esperadas, enLaBase)).toEqual(['audit_logs']);
  });

  it('no reporta nada cuando está todo', () => {
    const t = ['users', 'audit_logs'];
    expect(faltantes(t, [...t, 'tabla_extra_que_no_molesta'])).toEqual([]);
  });

  it('tablas de más en la base no son un problema', () => {
    // Drift cosmético o tablas de otra herramienta no deben bloquear el arranque.
    expect(faltantes(['users'], ['users', '_prisma_migrations', 'algo_viejo'])).toEqual([]);
  });
});
