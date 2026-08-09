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

/**
 * Un costista con una empresa, una estructura, un período y un dato con plata.
 *
 * Todo lo que cae bajo RLS se escribe dentro de una transacción con
 * `app.user_id` seteado. NO es un detalle de estilo: con las políticas
 * efectivamente activas, un INSERT sin ese `set_config` viola el `WITH CHECK` y
 * Postgres devuelve 42501.
 *
 * La primera versión de este helper insertaba con el cliente pelado y andaba.
 * Andaba porque el rol de la corrida era superusuario y RLS se ignoraba entero.
 * Que ahora falle si uno se olvida es justamente la señal de que las políticas
 * están puestas y se aplican.
 */
export async function createTenant(label: string): Promise<Tenant> {
  // `users` no tiene RLS: es la tabla desde la que se resuelve el inquilino.
  const user = await db.user.create({
    data: {
      email: `${label}-${randomUUID()}@test.local`,
      name: `Costista ${label}`,
      // Hash cualquiera con forma válida: estos tests no pasan por login.
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$0000000000000000$0000000000000000000000000000000',
      role: 'COSTISTA',
    },
  });

  const { company, structure, period, dataPoint } = await db.$transaction(async (tx) => {
    // El mismo mecanismo que usa la app en producción (`withTenant`): sin esto,
    // las políticas rechazan cada INSERT con 42501.
    await tx.$executeRaw`SELECT set_config('app.user_id', ${user.id}, true)`;

    const company = await tx.company.create({
      data: { userId: user.id, name: `Empresa ${label}`, periodicity: 'MONTHLY' },
    });

    const structure = await tx.costStructure.create({
      data: {
        userId: user.id,
        companyId: company.id,
        productName: `Producto ${label}`,
        period: '2026-08',
        costingSystem: 'ORDERS',
      },
    });

    const period = await tx.costPeriod.create({
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

    const dataPoint = await tx.dataPoint.create({
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

    await tx.dataPointVersion.create({
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

    return { company, structure, period, dataPoint };
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
 * NO SE BORRA NADA, y es a propósito.
 *
 * La primera versión de este helper desactivaba los triggers append-only para
 * poder limpiar. Eso ya no se puede, y las dos razones son buenas:
 *
 *   · `ALTER TABLE ... DISABLE TRIGGER` exige ser DUEÑO de la tabla, y los tests
 *     corren con el rol de la aplicación, que a propósito no lo es.
 *   · Las versiones de dato son append-only por diseño. Un helper de tests que
 *     sabe apagar esa garantía es un helper que alguien va a copiar.
 *
 * Por eso la base de integración es DESECHABLE: en CI es un contenedor nuevo en
 * cada corrida, y en local se recrea con `docker compose down -v && docker
 * compose up -d postgres`. Cada inquilino usa un email único, así que correrlo
 * varias veces sobre la misma base no pisa nada — solo acumula.
 */
export async function disconnect(): Promise<void> {
  await db.$disconnect();
}
