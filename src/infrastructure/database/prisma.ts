import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma singleton.
 *
 * En desarrollo, el hot-reload de tsx puede crear múltiples instancias; las
 * cacheamos en globalThis para evitar agotar el pool de conexiones.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Ejecuta un callback dentro de una transacción con el contexto de tenant
 * seteado para Row-Level Security.
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
  return prisma.$transaction(async (tx) => {
    // set_config con `true` => local a la transacción.
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}
