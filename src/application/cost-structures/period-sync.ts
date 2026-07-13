import type { Prisma, PrismaClient } from '@prisma/client';
import { ValidationError } from '../../domain/errors/domain-error.js';

/**
 * ESPEJO ESTRUCTURA → PERÍODO ABIERTO (problema C — Fase 3).
 *
 * La Fase 1 creó el período pero NO movió los datos de lugar (a propósito: una
 * migración que no borra nada). La app sigue escribiendo en `cost_structures`.
 * El período quedaba entonces con la foto del día en que se abrió, y eso rompía
 * dos cosas:
 *
 *   · El CIERRE validaba la actividad real y el CIP real contra esa foto vieja
 *     (siempre en cero) → no se podía cerrar ningún período.
 *   · El mes siguiente arrastraba la existencia de esa foto, no la real.
 *
 * Solución: toda escritura de datos en la estructura se espeja en el período
 * ABIERTO, en la misma transacción. El período pasa a ser dueño de los datos de
 * su mes sin que la pantalla cambie una línea.
 *
 * Y el candado: si la estructura tiene períodos y ninguno está abierto, el mes
 * está CERRADO y no se escribe. Las estructuras que nunca abrieron un período
 * (las de antes de esta función) siguen funcionando exactamente igual.
 */

/** Lo que se espeja: los tres elementos del costo y las ventas. */
export interface PeriodMirrorData {
  rawMaterialConfig?: Prisma.InputJsonValue;
  directLaborConfig?: Prisma.InputJsonValue;
  indirectCostConfig?: Prisma.InputJsonValue;
  salesUnitPrice?: number;
  salesQuantity?: number;
}

/** Acepta tanto el cliente de una transacción como el Prisma de siempre. */
type Db = Prisma.TransactionClient | PrismaClient;

/** El período en el que hoy se escribe, si hay uno. */
export async function findOpenPeriod(db: Db, structureId: string) {
  return db.costPeriod.findFirst({
    where: { structureId, status: 'OPEN' },
    orderBy: { code: 'desc' },
  });
}

/**
 * Devuelve el período abierto donde va a caer la escritura.
 *
 *   · Hay período abierto → se escribe ahí (y en la estructura).
 *   · La estructura no tiene ningún período (legado) → `null`: se escribe como
 *     siempre, sin período. No rompemos nada de lo que ya andaba.
 *   · Tiene períodos pero todos cerrados → ERROR: el mes está congelado.
 */
export async function requireWritablePeriod(db: Db, structureId: string) {
  const open = await findOpenPeriod(db, structureId);
  if (open) return open;

  const last = await db.costPeriod.findFirst({
    where: { structureId },
    orderBy: { code: 'desc' },
  });
  if (!last) return null; // estructura sin períodos: modo legado

  throw new ValidationError(
    `El período "${last.label}" está cerrado: los números quedaron congelados y no se pueden editar. ` +
      `Reabrilo (queda registrado) o abrí el período siguiente.`,
  );
}

/**
 * Escribe en el período abierto lo mismo que se acaba de escribir en la
 * estructura. Sin período abierto (estructura legada), no hace nada.
 */
export async function mirrorToOpenPeriod(
  db: Db,
  structureId: string,
  data: PeriodMirrorData,
): Promise<void> {
  const open = await findOpenPeriod(db, structureId);
  if (!open) return;
  await db.costPeriod.update({ where: { id: open.id }, data });
}
