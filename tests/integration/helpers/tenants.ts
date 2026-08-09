import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/**
 * Armado de DOS INQUILINOS COMPLETOS para probar aislamiento.
 *
 * Hasta acá cada test armaba su propio mock de Prisma a mano y ninguno tocaba
 * una base real, así que no había ni un factory que reusar. Esto es el mínimo
 * para poder preguntar "¿la empresa A puede leer algo de la B?": dos costistas
 * distintos, cada uno con su empresa, su estructura, su período y un dato
 * trazable con plata adentro.
 */

export const db = new PrismaClient();

export interface Tenant {
  userId: string;
  email: string;
  companyId: string;
  structureId: string;
  periodId: string;
  dataPointId: string;
}

/** Un costista con una empresa, una estructura, un período y un dato con plata. */
export async function createTenant(label: string): Promise<Tenant> {
  const user = await db.user.create({
    data: {
      email: `${label}-${randomUUID()}@test.local`,
      name: `Costista ${label}`,
      // Hash cualquiera con forma válida: estos tests no pasan por login.
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$0000000000000000$0000000000000000000000000000000',
      role: 'COSTISTA',
    },
  });

  const company = await db.company.create({
    data: { userId: user.id, name: `Empresa ${label}`, periodicity: 'MONTHLY' },
  });

  const structure = await db.costStructure.create({
    data: {
      userId: user.id,
      companyId: company.id,
      productName: `Producto ${label}`,
      period: '2026-08',
      costingSystem: 'ORDERS',
    },
  });

  const period = await db.costPeriod.create({
    data: {
      structureId: structure.id,
      companyId: company.id,
      userId: user.id,
      code: '2026-08',
      label: 'Agosto 2026',
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-31'),
      status: 'OPEN',
    },
  });

  const dataPoint = await db.dataPoint.create({
    data: {
      structureId: structure.id,
      element: 'MP',
      fieldKey: 'precio',
      label: `Precio secreto de ${label}`,
      unit: '$',
      sourceArea: 'contaduria',
      periodoImputado: '2026-08',
    },
  });

  await db.dataPointVersion.create({
    data: {
      dataPointId: dataPoint.id,
      versionN: 1,
      valueNum: label === 'A' ? 111_111 : 222_222,
      method: 'manual',
      createdBy: user.id,
      actorRole: 'COSTISTA',
      actorArea: 'contaduria',
    },
  });

  return {
    userId: user.id,
    email: user.email,
    companyId: company.id,
    structureId: structure.id,
    periodId: period.id,
    dataPointId: dataPoint.id,
  };
}

/**
 * Borra los dos inquilinos. En orden inverso a las dependencias y con SQL crudo
 * para `data_point_versions`: el trigger append-only prohíbe el DELETE por fila,
 * y hay que desactivarlo explícitamente para limpiar. Es exactamente la razón
 * por la que esta base tiene que ser DESECHABLE.
 */
export async function destroyTenants(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  await db.$executeRawUnsafe('ALTER TABLE "data_point_versions" DISABLE TRIGGER USER');
  await db.$executeRawUnsafe('ALTER TABLE "trace_audit_log" DISABLE TRIGGER USER');
  try {
    await db.dataPointVersion.deleteMany({ where: { createdBy: { in: userIds } } });
    await db.dataPoint.deleteMany({ where: { structure: { userId: { in: userIds } } } });
    await db.costPeriod.deleteMany({ where: { userId: { in: userIds } } });
    await db.costStructure.deleteMany({ where: { userId: { in: userIds } } });
    await db.company.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    await db.$executeRawUnsafe('ALTER TABLE "data_point_versions" ENABLE TRIGGER USER');
    await db.$executeRawUnsafe('ALTER TABLE "trace_audit_log" ENABLE TRIGGER USER');
  }
}
