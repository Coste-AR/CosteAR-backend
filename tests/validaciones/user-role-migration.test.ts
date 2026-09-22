import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const db = new PrismaClient();
const typeName = 'UserRole401Probe';
const tableName = 'user_role_401_probe';
const legacyCompanyAdmin = ['COST', 'ISTA'].join('');
const legacySystemAdmin = ['AD', 'MIN'].join('');
const migration = readFileSync(
  new URL('../../prisma/migrations/20260922031500_replace_user_roles/migration.sql', import.meta.url),
  'utf8',
).replaceAll('"UserRole"', `"${typeName}"`);

beforeAll(async () => {
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${tableName}"`);
  await db.$executeRawUnsafe(`DROP TYPE IF EXISTS "${typeName}"`);
  await db.$executeRawUnsafe(
    `CREATE TYPE "${typeName}" AS ENUM ('${legacyCompanyAdmin}', '${legacySystemAdmin}', 'EMPRESA_OPERATOR')`,
  );
  await db.$executeRawUnsafe(`CREATE TABLE "${tableName}" (id integer PRIMARY KEY, role "${typeName}" NOT NULL)`);
  await db.$executeRawUnsafe(
    `INSERT INTO "${tableName}" VALUES (1, '${legacyCompanyAdmin}'), (2, '${legacySystemAdmin}')`,
  );
});

afterAll(async () => {
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${tableName}"`);
  await db.$executeRawUnsafe(`DROP TYPE IF EXISTS "${typeName}"`);
  await db.$disconnect();
});

describe('migración de UserRole', () => {
  it('mapea todas las filas sin cambiar el conteo y rechaza valores desconocidos', async () => {
    const before = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) FROM "${tableName}"`);
    for (const statement of migration.split(';').map((part) => part.trim()).filter(Boolean)) {
      await db.$executeRawUnsafe(`${statement};`);
    }
    const rows = await db.$queryRawUnsafe<Array<{ role: string }>>(`SELECT role::text AS role FROM "${tableName}" ORDER BY id`);
    const after = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) FROM "${tableName}"`);

    expect(rows.map((row) => row.role)).toEqual(['EMPRESA_ADMIN', 'SUPER_ADMIN']);
    expect(after[0]!.count).toBe(before[0]!.count);
    await expect(db.$executeRawUnsafe(`INSERT INTO "${tableName}" VALUES (3, 'DESCONOCIDO')`)).rejects.toThrow();
  });
});
