import { PrismaClient } from '@prisma/client';
import { currentTenantId, enterExplicitTransaction, inExplicitTransaction } from './tenant-context.js';

/**
 * Cliente Prisma singleton.
 *
 * En desarrollo, el hot-reload de tsx puede crear múltiples instancias; las
 * cacheamos en globalThis para evitar agotar el pool de conexiones.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const base =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

/**
 * LAS TABLAS CON RLS, y solo esas.
 *
 * Espeja `prisma/rls.sql`. Acotar la lista importa: cada consulta a un modelo de
 * acá paga una transacción para poder setear `app.user_id`, y no tiene sentido
 * pagarla en `users`, `terms_versions` o el resto, que no tienen políticas.
 *
 * Si agregás una tabla a `rls.sql`, agregala acá. Si no, sus lecturas van a
 * volver vacías en cuanto el rol de conexión deje de ignorar RLS — que es
 * justamente el bug que este archivo existe para cerrar.
 */
const RLS_MODELS = new Set([
  'Company',
  'CostStructure',
  'CostCalculation',
  'Alert',
  'AlertSetting',
  'DataPoint',
  'DataPointVersion',
  'CalculationRun',
  'CalculationNode',
  'ProcessDepartment',
  'UnitMovementSchedule',
  'JointCostAllocation',
  'JointCostByProductLine',
]);

/**
 * SETEA EL INQUILINO EN CADA CONSULTA, no solo en las escrituras.
 *
 * `SET LOCAL app.user_id` vale para la transacción en curso, así que la consulta
 * tiene que viajar en la MISMA transacción que el `set_config`. Por eso el par
 * va en un `$transaction([...])`: es el patrón que documenta Prisma para RLS, y
 * a diferencia de una transacción interactiva no retiene la conexión mientras
 * corre código de aplicación.
 *
 * Sin contexto de inquilino (workers, arranque, `asSystem`) la consulta pasa
 * derecho: no se inventa un usuario. Y adentro de `withTenant` también pasa
 * derecho, porque esa transacción ya seteó el valor y anidar otra fallaría.
 */
const extended = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, args, query }) {
        const userId = currentTenantId();
        if (!userId || inExplicitTransaction() || !RLS_MODELS.has(model)) {
          return query(args);
        }
        const [, result] = await base.$transaction([
          base.$executeRaw`SELECT set_config('app.user_id', ${userId}, TRUE)`,
          query(args),
        ]);
        return result;
      },
    },
  },
});

/**
 * El tipo extendido no es asignable a `PrismaClient`, y los 22 servicios reciben
 * `db: PrismaClient` por constructor. El casteo mantiene ese contrato: en
 * runtime es el cliente extendido, y la extensión no agrega ni saca métodos —
 * solo envuelve los que ya existen.
 */
export const prisma = extended as unknown as PrismaClient;

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = base;
}

/**
 * Ejecuta un callback dentro de una transacción con el contexto de tenant
 * seteado para Row-Level Security.
 *
 * Sigue existiendo para las escrituras que necesitan atomicidad entre varias
 * tablas. La diferencia con antes es que ya no es el ÚNICO lugar donde se setea
 * el inquilino: las lecturas ahora también lo hacen, vía la extensión de arriba.
 *
 * `SET LOCAL app.user_id` aplica solo a la transacción actual; las políticas
 * RLS de PostgreSQL leen ese valor con `current_setting('app.user_id')` y
 * filtran cada query a las filas del tenant. Aunque un bug en la capa de
 * aplicación olvide filtrar por userId, la base NO devuelve datos ajenos.
 */
export async function withTenant<T>(
  userId: string,
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return base.$transaction(async (tx) => {
    // set_config con `true` => local a la transacción.
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    // La extensión tiene que quedarse quieta acá adentro: el valor ya está
    // seteado, y abrir otra transacción por consulta fallaría.
    return enterExplicitTransaction(() => fn(tx));
  });
}
