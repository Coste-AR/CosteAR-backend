import { randomUUID } from 'node:crypto';
import { prisma } from '@/infrastructure/database/prisma.js';
import { withTenantContext } from '@/infrastructure/database/tenant-context.js';

/**
 * Armado de DOS INQUILINOS COMPLETOS para probar aislamiento.
 *
 * Hasta acá cada test armaba su propio mock de Prisma a mano y ninguno tocaba
 * una base real, así que no había ni un factory que reusar. Esto es el mínimo
 * para poder preguntar "¿la empresa A puede leer algo de la B?": dos costistas
 * distintos, cada uno con su empresa, su estructura, su período y un dato
 * trazable con plata adentro.
 */

/**
 * EL CLIENTE DE LA APP, no uno nuevo.
 *
 * Antes esto creaba su propio `new PrismaClient()`, y eso hacía que la suite se
 * salteara la extensión que setea el inquilino en cada consulta — o sea, probaba
 * un camino que la aplicación real no usa. Con el cliente de verdad, lo que se
 * prueba es lo que corre en producción.
 */
export const db = prisma;

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
 * Todo lo que cae bajo RLS se escribe dentro del contexto de inquilino. NO es un
 * detalle de estilo: con las políticas activas, un INSERT sin `app.user_id`
 * viola el `WITH CHECK` y Postgres devuelve 42501.
 *
 * La primera versión de este helper insertaba con el cliente pelado y andaba.
 * Andaba porque el rol de la corrida era superusuario y RLS se ignoraba entero.
 * Que ahora falle si uno se olvida es justamente la señal de que las políticas
 * están puestas y se aplican.
 *
 * Ya no abre la transacción a mano: la extensión de Prisma setea el inquilino en
 * cada consulta, igual que en una request real. Armar los datos por el mismo
 * camino que usa la app es parte de lo que esta suite tiene que probar.
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

  const { company, structure, period, dataPoint } = await withTenantContext(user.id, async () => {
    const tx = db;

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
