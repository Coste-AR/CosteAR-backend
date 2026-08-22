import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';
import { MissingAllocationBaseError } from '../../domain/errors/calculation-errors.js';

/**
 * Bases de asignación (Parte 4). Catálogo del sistema (precargado por la
 * migración) + bases personalizadas por empresa, y los valores por centro
 * dentro de una estructura.
 *
 * Los valores son datos trazables: `dataPointId` puede enlazar a su ficha. El
 * borrado es lógico (`voidedAt`, R1). El upsert versiona por unicidad
 * (base × estructura × centro): al recargar un valor, se marca el anterior
 * como anulado y se inserta uno nuevo (no se pisa el histórico).
 */
export class AllocationBaseService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async requireStructure(userId: string, structureId: string) {
    const s = await this.db.costStructure.findFirst({
      where: { id: structureId, userId },
      include: { company: true },
    });
    if (!s) throw new NotFoundError('Estructura de costos no encontrada');
    return s;
  }

  private async requireCompany(userId: string, companyId: string) {
    const c = await this.db.company.findFirst({ where: { id: companyId, userId } });
    if (!c) throw new NotFoundError('Empresa no encontrada');
    return c;
  }

  /** Catálogo visible para una empresa: bases del sistema + las propias. */
  async listCatalog(userId: string, companyId: string) {
    await this.requireCompany(userId, companyId);
    return this.db.allocationBase.findMany({
      where: { OR: [{ companyId: null }, { companyId }] },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  /** Alta de una base personalizada de la empresa (extensible por el costista). */
  async createCustom(
    userId: string,
    companyId: string,
    input: { code: string; name: string; unit: string; description?: string },
  ) {
    await this.requireCompany(userId, companyId);
    return this.db.allocationBase.create({
      data: {
        companyId,
        code: input.code,
        name: input.name,
        unit: input.unit,
        description: input.description,
        isSystem: false,
      },
    });
  }

  /** Valores de base cargados para una estructura (no anulados). */
  async listValues(userId: string, structureId: string) {
    await this.requireStructure(userId, structureId);
    return this.db.allocationBaseValue.findMany({
      where: { structureId, voidedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Carga (o recarga) el valor de una base para un centro. Append-only: si ya
   * había un valor vigente para (base, estructura, centro), lo anula y crea
   * uno nuevo, preservando el histórico (R1).
   */
  async setValue(
    userId: string,
    structureId: string,
    input: { baseId: string; centerId: string; value: number; note?: string; dataPointId?: string },
  ) {
    await this.requireStructure(userId, structureId);
    return this.db.$transaction(async (tx) => {
      await tx.allocationBaseValue.updateMany({
        where: { baseId: input.baseId, structureId, centerId: input.centerId, voidedAt: null },
        data: { voidedAt: new Date() },
      });
      return tx.allocationBaseValue.create({
        data: {
          baseId: input.baseId,
          structureId,
          centerId: input.centerId,
          value: input.value,
          note: input.note,
          dataPointId: input.dataPointId,
          createdBy: userId,
        },
      });
    });
  }

  /**
   * Sincroniza (persiste) al registro trazable las unidades por centro de una
   * base, tomándolas de la config al guardar (3b-2). Append-only con detección
   * de cambios: solo versiona los centros cuyo valor cambió, y anula los que ya
   * no están en la base, dejando la tabla como ESPEJO exacto de la config. Si la
   * base no está en el catálogo (ej. un valor legado "fuera del catálogo"), no
   * persiste nada y devuelve 0 (el motor cae al valor de la config). Devuelve la
   * cantidad de centros modificados.
   */
  async syncValues(
    userId: string,
    structureId: string,
    baseCode: string,
    units: Record<string, number>,
  ): Promise<number> {
    const s = await this.requireStructure(userId, structureId);
    const base = await this.db.allocationBase.findFirst({
      where: { code: baseCode, OR: [{ companyId: null }, { companyId: s.companyId }] },
    });
    if (!base) return 0; // base no catalogada → no se persiste; se usa la config
    const current = await this.db.allocationBaseValue.findMany({
      where: { baseId: base.id, structureId, voidedAt: null },
    });
    const curMap = new Map(current.map((v) => [v.centerId, Number(v.value)]));
    const provided = new Set(Object.keys(units));
    let changed = 0;

    // Alta/actualización: solo si el valor cambió (evita versionar de más).
    for (const [centerId, raw] of Object.entries(units)) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) continue;
      if (curMap.get(centerId) === value) continue;
      await this.setValue(userId, structureId, { baseId: base.id, centerId, value });
      changed++;
    }
    // Baja lógica: centros que ya no están en la base quedan anulados (espejo).
    for (const v of current) {
      if (!provided.has(v.centerId)) {
        await this.db.allocationBaseValue.updateMany({
          where: { baseId: base.id, structureId, centerId: v.centerId, voidedAt: null },
          data: { voidedAt: new Date() },
        });
        changed++;
      }
    }
    return changed;
  }

  /**
   * Resuelve las unidades por centro de una base (para el prorrateo primario
   * en modo 'base'). Devuelve `{ centerId: value }` con los valores vigentes.
   * Si no hay ningún valor cargado para esa base, lanza 422 accionable.
   */
  async resolveBaseUnits(
    userId: string,
    structureId: string,
    baseCode: string,
  ): Promise<Record<string, number>> {
    const s = await this.requireStructure(userId, structureId);
    const base = await this.db.allocationBase.findFirst({
      where: { code: baseCode, OR: [{ companyId: null }, { companyId: s.companyId }] },
    });
    if (!base) {
      throw new MissingAllocationBaseError(
        baseCode,
        `La base de asignación "${baseCode}" no existe en el catálogo. Elegí una base válida o creala.`,
      );
    }
    const values = await this.db.allocationBaseValue.findMany({
      where: { baseId: base.id, structureId, voidedAt: null },
    });
    if (values.length === 0) {
      throw new MissingAllocationBaseError(
        baseCode,
        `La base "${base.name}" no tiene valores cargados por centro para esta estructura. Cargá la superficie/horas/etc. de cada centro.`,
      );
    }
    const out: Record<string, number> = {};
    for (const v of values) out[v.centerId] = Number(v.value);
    return out;
  }
}
