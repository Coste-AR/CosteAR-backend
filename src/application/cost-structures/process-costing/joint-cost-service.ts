import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma, withTenant } from '../../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../../audit/trace-audit.js';
import { DataPointService } from '../../trazabilidad/data-point-service.js';
import {
  allocateJointCosts,
  type JointProduct,
  type JointAllocationMethod,
  type JointCostAllocationResult,
} from '../../../domain/calculations/joint-costs.js';
import { ProcessValidationError } from '../../../domain/errors/calculation-errors.js';
import { NotFoundError, UnprocessableEntityError } from '../../../domain/errors/domain-error.js';
import type { JointCostInputBody, JointProductInput } from '../../../shared/schemas/joint-cost.schema.js';

/**
 * COSTEO POR PROCESOS · REPARTO DE COSTOS CONJUNTOS COMO SERVICIO (B16)
 *
 * Hace editable y persistente el reparto del costo conjunto de UN departamento
 * que es punto de separación, para UN período. Se apoya en la función PURA del
 * dominio `allocateJointCosts` (B11): el servicio NUNCA reimplementa la
 * matemática de los cuatro métodos (PHYSICAL_UNITS / TECHNICAL_YIELD /
 * MARKET_VALUE / NET_REALIZABLE_VALUE), solo la orquesta (validar → repartir →
 * persistir → auditar → trazar).
 *
 * FX-J2 — MOSTRAR LA PÉRDIDA, NUNCA OCULTARLA: un método puede asignarle a un
 * producto un costo mayor a su valor de mercado (típico del factor técnico, que
 * reparte por rendimiento e ignora el precio). Ese producto queda con MARGEN
 * NEGATIVO, pero el reparto es válido: el servicio lo devuelve con TODOS sus
 * números (costo asignado, costo unitario, valor de mercado y margen) marcado
 * como pérdida — jamás lo descarta en silencio.
 *
 * TRAZABILIDAD: cada valor que el usuario CARGA A MANO (costo conjunto total y,
 * por línea, unidades / rendimiento / precio / gastos de comercialización) se
 * persiste como un `DataPoint` versionado vía `DataPointService`, igual que B15.
 * Los resultados CALCULADOS (costo asignado y costo unitario) NO son DataPoints:
 * son derivados, no ingresados.
 *
 * Todo lo que muta corre dentro de UNA transacción (`withTenant`, que además
 * setea el tenant para RLS) y deja su auditoría en esa misma transacción.
 */

/** Insumos manuales POR LÍNEA que se trazan como DataPoints (los que el usuario carga). */
const PRODUCT_TRACE_FIELDS = [
  'unitsObtained',
  'yieldPct',
  'marketPrice',
  'sellingCostVarPct',
  'sellingCostFixedPerUnit',
] as const;
type ProductTraceField = (typeof PRODUCT_TRACE_FIELDS)[number];

/**
 * Metadatos de trazabilidad por insumo. `element` mapea al `CostElement` que
 * mejor describe el impacto del dato: las cifras de costo/físicas van a MP (el
 * costo conjunto es MP + conversión acumulada; unidades y rendimiento son
 * físicos) y las de venta (precio y gastos de comercialización) a VENTA, para
 * que la ficha de trazabilidad muestre los impactos correctos. Ver DECISIONES.md
 * (B16). El enum no tiene una opción "unidades"/"rendimiento", así que MP es el
 * hogar natural de esas cifras, igual que en el cuadro de movimiento (B15).
 */
const PRODUCT_FIELD_META: Record<
  ProductTraceField,
  { label: string; unit: string; element: 'MP' | 'VENTA' }
> = {
  unitsObtained: { label: 'Unidades obtenidas en el punto de separación', unit: 'u', element: 'MP' },
  yieldPct: { label: 'Rendimiento técnico', unit: '%', element: 'MP' },
  marketPrice: { label: 'Precio de mercado en el punto de separación', unit: '$', element: 'VENTA' },
  sellingCostVarPct: { label: 'Gasto de comercialización variable', unit: '%', element: 'VENTA' },
  sellingCostFixedPerUnit: { label: 'Gasto de comercialización fijo por unidad', unit: '$', element: 'VENTA' },
};

const JOINT_TOTAL_META = { label: 'Costo conjunto total', unit: '$', element: 'MP' as const };

interface JointContext {
  structure: { id: string; productName: string };
  department: { id: string; name: string };
  period: { id: string; label: string; code: string };
}

/** Fila persistida de una línea de producto (subconjunto que usamos). */
type ByProductRow = {
  productName: string;
  kind: string;
  unitsObtained: Prisma.Decimal | number;
  yieldPct: Prisma.Decimal | number | null;
  marketPrice: Prisma.Decimal | number | null;
  sellingCostVarPct: Prisma.Decimal | number | null;
  sellingCostFixedPerUnit: Prisma.Decimal | number | null;
  byproductRecognition: string | null;
};

export class JointCostService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly dataPoints: DataPointService = new DataPointService(db),
  ) {}

  /**
   * Devuelve la configuración del reparto guardada + el RESULTADO recalculado con
   * el dominio (costo asignado y costo unitario por línea, más el valor de mercado
   * y el margen para señalar las pérdidas), y el `dataPointId` de cada insumo
   * trazable para que el front abra la ficha.
   */
  async get(userId: string, structureId: string, deptId: string, periodId: string) {
    const ctx = await this.resolveContext(userId, structureId, deptId, periodId);
    const allocation = await this.db.jointCostAllocation.findUnique({
      where: { departmentId_periodId: { departmentId: deptId, periodId } },
      include: { products: { orderBy: { productName: 'asc' } } },
    });

    if (!allocation) {
      return {
        department: ctx.department.name,
        period: ctx.period.label,
        exists: false,
        saved: null,
        result: null,
        traces: null,
      };
    }

    const products = allocation.products as ByProductRow[];
    const result = this.compute(
      ctx,
      allocation.method as JointAllocationMethod,
      allocation.jointCostTotal,
      products,
    );

    return {
      department: ctx.department.name,
      period: ctx.period.label,
      exists: true,
      saved: this.serializeSaved(allocation.method as JointAllocationMethod, allocation.jointCostTotal, products),
      result: this.serializeResult(result, products),
      traces: await this.tracesFor(ctx, products.map((p) => p.productName)),
    };
  }

  /**
   * Persiste el reparto (upsert por departamento+período), lo computa con el
   * dominio, guarda `allocatedCost`/`unitCost` por línea, traza cada insumo
   * manual y devuelve el resultado. TODO en una sola transacción atómica y
   * auditada. La validación de dominio (Σ% ≠ 100 %, base 0, VNR negativo, campos
   * faltantes) corre ANTES de escribir: si falla, sale un 422 y nada se toca.
   */
  async save(
    userId: string,
    structureId: string,
    deptId: string,
    periodId: string,
    body: JointCostInputBody,
    actor: TraceActor,
  ) {
    const ctx = await this.resolveContext(userId, structureId, deptId, periodId);

    // 1) Repartir con el dominio ANTES de escribir (valida y computa el resultado).
    const result = this.computeFromInput(ctx, body.method, body.jointCostTotal, body.products);

    return withTenant(userId, async (tx) => {
      const prev = await tx.jointCostAllocation.findUnique({
        where: { departmentId_periodId: { departmentId: deptId, periodId } },
        select: { id: true },
      });

      // Upsert de la cabecera; las líneas se reemplazan (el reparto es una
      // configuración editable, no un log; la append-only vive en los DataPoints).
      const allocation = await tx.jointCostAllocation.upsert({
        where: { departmentId_periodId: { departmentId: deptId, periodId } },
        create: {
          structureId: ctx.structure.id,
          departmentId: deptId,
          periodId,
          method: body.method,
          jointCostTotal: body.jointCostTotal,
        },
        update: { method: body.method, jointCostTotal: body.jointCostTotal },
      });

      await tx.byProductLine.deleteMany({ where: { allocationId: allocation.id } });
      for (let i = 0; i < body.products.length; i++) {
        const p = body.products[i]!;
        const line = result.lines[i]!;
        await tx.byProductLine.create({
          data: {
            allocationId: allocation.id,
            productName: p.productName,
            kind: p.kind,
            unitsObtained: p.unitsObtained,
            yieldPct: p.yieldPct ?? null,
            marketPrice: p.marketPrice ?? null,
            sellingCostVarPct: p.sellingCostVarPct ?? null,
            sellingCostFixedPerUnit: p.sellingCostFixedPerUnit ?? null,
            byproductRecognition: p.byproductRecognition ?? null,
            // Resultados CALCULADOS por el dominio (no son DataPoints).
            allocatedCost: line.allocatedCost.toNumber(),
            unitCost: line.unitCost.toNumber(),
          },
        });
      }

      await recordTraceAudit(
        {
          entityType: 'JointCostAllocation',
          entityId: allocation.id,
          action: prev ? 'actualizar' : 'crear',
          actor,
          after: this.serializeResult(result, body.products),
        },
        tx,
      );

      // 2) Trazabilidad: un DataPoint por cada insumo MANUAL. El costo conjunto
      //    total y, por línea, los insumos presentes. Los resultados (asignado /
      //    unitario) NO se trazan.
      await this.traceNumber(tx, ctx, this.jointTotalKey(ctx), JOINT_TOTAL_META, body.jointCostTotal, body, actor);
      for (const p of body.products) {
        for (const field of PRODUCT_TRACE_FIELDS) {
          const raw = p[field];
          if (raw === undefined) continue; // no ingresado → no es DataPoint
          await this.traceNumber(
            tx,
            ctx,
            this.productKey(ctx, p.productName, field),
            { ...PRODUCT_FIELD_META[field], productName: p.productName },
            raw,
            body,
            actor,
          );
        }
      }

      return {
        department: ctx.department.name,
        period: ctx.period.label,
        saved: this.serializeSaved(body.method, body.jointCostTotal, body.products),
        result: this.serializeResult(result, body.products),
      };
    });
  }

  // --------------------------------------------------------------------------
  // Internos
  // --------------------------------------------------------------------------

  /** Propiedad (tenant) + que la estructura sea de Procesos + depto./período válidos. */
  private async resolveContext(
    userId: string,
    structureId: string,
    deptId: string,
    periodId: string,
  ): Promise<JointContext> {
    const structure = await this.db.costStructure.findFirst({ where: { id: structureId, userId, deletedAt: null } });
    if (!structure) throw new NotFoundError('Estructura de costos no encontrada');
    if (structure.costingSystem !== 'PROCESSES') {
      throw new UnprocessableEntityError(
        `La estructura «${structure.productName}» usa Costeo por Órdenes; el reparto de costos conjuntos ` +
          'solo aplica a estructuras de Costeo por Procesos.',
      );
    }

    const department = await this.db.processDepartment.findFirst({
      where: { id: deptId, structureId, deletedAt: null },
    });
    if (!department) throw new NotFoundError('Departamento de proceso no encontrado');

    const period = await this.db.costPeriod.findFirst({ where: { id: periodId, structureId } });
    if (!period) throw new NotFoundError('Período de costos no encontrado');

    return {
      structure: { id: structure.id, productName: structure.productName },
      department: { id: department.id, name: department.name },
      period: { id: period.id, label: period.label, code: period.code },
    };
  }

  /** Corre el dominio sobre líneas del BODY; si lanza 422, nombra el departamento. */
  private computeFromInput(
    ctx: JointContext,
    method: JointAllocationMethod,
    jointCostTotal: number,
    products: JointProductInput[],
  ): JointCostAllocationResult {
    return this.runDomain(ctx, method, jointCostTotal, products.map(this.toDomainProduct));
  }

  /** Corre el dominio sobre líneas PERSISTIDAS. */
  private compute(
    ctx: JointContext,
    method: JointAllocationMethod,
    jointCostTotal: Prisma.Decimal | number,
    products: ByProductRow[],
  ): JointCostAllocationResult {
    return this.runDomain(ctx, method, Number(jointCostTotal), products.map(this.toDomainProduct));
  }

  private runDomain(
    ctx: JointContext,
    method: JointAllocationMethod,
    jointCostTotal: number,
    products: JointProduct[],
  ): JointCostAllocationResult {
    try {
      return allocateJointCosts(products, method, jointCostTotal);
    } catch (e) {
      throw this.nameDepartment(e, ctx.department.name);
    }
  }

  /** Mapea una línea (body o fila) a la forma que espera el dominio. */
  private toDomainProduct(
    p: JointProductInput | ByProductRow,
  ): JointProduct {
    const n = (x: Prisma.Decimal | number | null | undefined): number | undefined =>
      x === null || x === undefined ? undefined : Number(x);
    return {
      productName: p.productName,
      unitsObtained: Number(p.unitsObtained),
      yieldPct: n(p.yieldPct),
      marketPrice: n(p.marketPrice),
      sellingCostVarPct: n(p.sellingCostVarPct),
      sellingCostFixedPerUnit: n(p.sellingCostFixedPerUnit),
    };
  }

  /** Antepone el nombre del departamento al mensaje del dominio (regla: nunca un id). */
  private nameDepartment(e: unknown, name: string): unknown {
    if (e instanceof ProcessValidationError) {
      return new ProcessValidationError(
        `Departamento «${name}»: ${e.message}`,
        e.details as Record<string, unknown> | undefined,
      );
    }
    return e;
  }

  /**
   * Serializa el resultado del reparto. Por línea incluye el valor de mercado y el
   * MARGEN (valor de mercado − costo asignado) con su bandera `isLoss`, para que
   * una línea con pérdida (FX-J2) se MUESTRE con todos sus números, nunca se
   * descarte. El margen queda en `null` si no hay precio de mercado cargado (no se
   * inventa un valor de venta).
   */
  private serializeResult(
    result: JointCostAllocationResult,
    products: Array<{ productName: string; kind?: string; marketPrice?: Prisma.Decimal | number | null }>,
  ) {
    return {
      method: result.method,
      jointCostTotal: result.jointCostTotal.toNumber(),
      totalAllocated: result.totalAllocated.toNumber(),
      lines: result.lines.map((l, i) => {
        const src = products[i];
        const marketPrice = src?.marketPrice != null ? Number(src.marketPrice) : null;
        const marketValue = marketPrice != null ? l.unitsObtained.times(marketPrice).toNumber() : null;
        const margin = marketValue != null ? marketValue - l.allocatedCost.toNumber() : null;
        return {
          productName: l.productName,
          kind: src?.kind ?? 'coproduct',
          unitsObtained: l.unitsObtained.toNumber(),
          allocationBase: l.allocationBase.toNumber(),
          participationPct: l.participationPct.toNumber(),
          allocatedCost: l.allocatedCost.toNumber(),
          unitCost: l.unitCost.toNumber(),
          marketValue,
          margin,
          isLoss: margin != null && margin < 0,
        };
      }),
    };
  }

  /** Configuración cargada (insumos manuales), tal cual se persiste/recibe. */
  private serializeSaved(
    method: JointAllocationMethod,
    jointCostTotal: Prisma.Decimal | number,
    products: Array<JointProductInput | ByProductRow>,
  ) {
    const n = (x: Prisma.Decimal | number | null | undefined): number | null =>
      x === null || x === undefined ? null : Number(x);
    return {
      method,
      jointCostTotal: Number(jointCostTotal),
      products: products.map((p) => ({
        productName: p.productName,
        kind: p.kind ?? 'coproduct',
        unitsObtained: Number(p.unitsObtained),
        yieldPct: n(p.yieldPct),
        marketPrice: n(p.marketPrice),
        sellingCostVarPct: n(p.sellingCostVarPct),
        sellingCostFixedPerUnit: n(p.sellingCostFixedPerUnit),
        byproductRecognition: p.byproductRecognition ?? null,
      })),
    };
  }

  /** Persiste UN insumo manual como DataPoint trazable (crea o versiona). */
  private async traceNumber(
    tx: Prisma.TransactionClient,
    ctx: JointContext,
    fieldKey: string,
    meta: { label: string; unit: string; element: 'MP' | 'VENTA'; productName?: string },
    raw: number,
    body: JointCostInputBody,
    actor: TraceActor,
  ): Promise<void> {
    const label = meta.productName
      ? `${meta.label} · ${meta.productName} · ${ctx.department.name}, ${ctx.period.label}`
      : `${meta.label} · ${ctx.department.name}, ${ctx.period.label}`;
    const valueJson = {
      scope: 'joint-costs',
      departmentId: ctx.department.id,
      periodId: ctx.period.id,
      productName: meta.productName ?? null,
    };

    const existing = await tx.dataPoint.findFirst({
      where: { structureId: ctx.structure.id, fieldKey },
      include: { versions: { orderBy: { versionN: 'desc' }, take: 1 } },
    });

    if (!existing) {
      await this.dataPoints.createInTx(
        tx,
        ctx.structure.id,
        {
          element: meta.element,
          fieldKey,
          label,
          unit: meta.unit,
          // El dato del reparto ya sabe de qué período es (igual que el cuadro de
          // movimiento, unit-movement-service.ts). Sin esto nacía sin imputar y
          // trababa el cierre del mes: con un punto de separación de 3 productos
          // eran 10 fichas para imputar a mano antes de poder cerrar (H6).
          periodoImputado: ctx.period.code,
          sourceArea: body.sourceArea,
          method: body.captureMethod,
          valueNum: raw,
          valueJson,
        },
        actor,
      );
      return;
    }

    // Sin cambio de valor ⇒ no versionamos (no dejamos versiones espurias).
    const lastValue = existing.versions[0]?.valueNum;
    if (lastValue != null && Number(lastValue) === raw) return;

    await this.dataPoints.addVersionInTx(
      tx,
      existing.id,
      { fechaHecho: existing.fechaHecho },
      {
        sourceArea: body.sourceArea,
        method: body.captureMethod,
        valueNum: raw,
        valueJson,
        reason: 'Actualización del reparto de costos conjuntos',
      },
      actor,
    );
  }

  /** Clave estable del costo conjunto total (única por estructura+depto+período). */
  private jointTotalKey(ctx: JointContext): string {
    return `proceso.costos-conjuntos.${ctx.period.id}.${ctx.department.id}.jointCostTotal`;
  }

  /** Clave estable de un insumo de línea (única por estructura+depto+período+producto+campo). */
  private productKey(ctx: JointContext, productName: string, field: ProductTraceField): string {
    return `proceso.costos-conjuntos.${ctx.period.id}.${ctx.department.id}.producto.${productName}.${field}`;
  }

  /**
   * `dataPointId` de cada insumo trazable: el costo conjunto total y, por
   * producto, cada campo cargado (null si no se cargó). El front usa estos ids
   * para abrir la ficha de trazabilidad.
   */
  private async tracesFor(ctx: JointContext, productNames: string[]) {
    const keys = [
      this.jointTotalKey(ctx),
      ...productNames.flatMap((name) => PRODUCT_TRACE_FIELDS.map((f) => this.productKey(ctx, name, f))),
    ];
    const dps = await this.db.dataPoint.findMany({
      where: { structureId: ctx.structure.id, fieldKey: { in: keys }, voidedAt: null },
      select: { id: true, fieldKey: true },
    });
    const byKey = new Map(dps.map((d) => [d.fieldKey, d.id]));

    return {
      jointCostTotal: byKey.get(this.jointTotalKey(ctx)) ?? null,
      products: productNames.map((name) => ({
        productName: name,
        fields: Object.fromEntries(
          PRODUCT_TRACE_FIELDS.map((f) => [f, byKey.get(this.productKey(ctx, name, f)) ?? null]),
        ) as Record<ProductTraceField, string | null>,
      })),
    };
  }
}
