import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

function filesBelow(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

describe('roles de usuario legados', () => {
  it('no deja roles anteriores como valores de UserRole en código, schema, tests, seeds u OpenAPI', () => {
    const files = [
      ...filesBelow(join(root, 'src')),
      ...filesBelow(join(root, 'tests')).filter((file) => file !== import.meta.filename),
      join(root, 'prisma', 'schema.prisma'),
      join(root, 'scripts', 'seed-admin.ts'),
      join(root, 'scripts', 'create-operator.mjs'),
      join(root, 'openapi', 'openapi.json'),
    ];
    const nonRoleVocabulary = join(root, 'src', 'infrastructure', 'classifier', 'layers', 'layer4-payroll-routing.ts');
    const offenders = files.filter((file) => file !== nonRoleVocabulary).flatMap((file) => {
      const legacyRoles = ['COST' + 'ISTA', 'AD' + 'MIN'];
      const matches = readFileSync(file, 'utf8').match(new RegExp(`(?<![A-Z_])(${legacyRoles.join('|')})(?![A-Z_])`, 'g'));
      return matches ? [`${relative(root, file)}: ${[...new Set(matches)].join(', ')}`] : [];
    });
    expect(offenders).toEqual([]);
  });
});
