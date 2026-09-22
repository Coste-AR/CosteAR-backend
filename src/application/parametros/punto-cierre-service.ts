import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { calcularPuntosCierre, type ConceptoErogableValorizado } from '../../domain/calculations/punto-cierre.js';
import { resolverConceptoCosteo, type FilaConceptoCosteo } from '../../domain/parametros/concepto-costeo.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import type { GuardarImporteConceptoInput, PuntoCierreQuery } from '../../shared/schemas/punto-cierre.schema.js';

export class PuntoCierreService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async empresa(userId: string, companyId: string) {
    const company = await this.db.company.findFirst({ where: { id: companyId, userId } });
    if (!company) throw new NotFoundError('Empresa no encontrada');
  }

  async guardarImporte(userId: string, role: string, companyId: string, conceptoId: string, input: GuardarImporteConceptoInput, actor: TraceActor) {
    if (role !== 'EMPRESA_ADMIN') throw new ForbiddenError('Solo la cuenta administradora de la empresa puede declarar importes.');
    await this.empresa(userId, companyId);
    const concepto = await this.db.conceptoCosteo.findFirst({ where: { id: conceptoId, companyId, deletedAt: null } });
    if (!concepto) throw new NotFoundError('Concepto de costeo no encontrado');
    const requiereFijo = concepto.comportamientoVolumen === 'FIJO' || concepto.comportamientoVolumen === 'SEMIFIJO';
    const requiereVariable = concepto.comportamientoVolumen === 'VARIABLE' || concepto.comportamientoVolumen === 'SEMIFIJO';
    if (!concepto.comportamientoVolumen) throw new UnprocessableEntityError('Falta declarar el comportamiento del concepto.', { field: 'comportamientoVolumen' });
    if (requiereFijo && input.importeFijo === undefined) throw new UnprocessableEntityError('Falta la porción fija exigida por el comportamiento.', { field: 'importeFijo' });
    if (requiereVariable && input.importeVariableUnitario === undefined) throw new UnprocessableEntityError('Falta la porción variable exigida por el comportamiento.', { field: 'importeVariableUnitario' });
    return withTenant(userId, async (tx) => {
      const guardado = await tx.conceptoCosteoImporte.create({ data: {
        companyId, userId, conceptoId, importeFijo: input.importeFijo,
        importeVariableUnitario: input.importeVariableUnitario, moneda: input.moneda,
        unidad: input.unidad, vigenteDesde: new Date(input.vigenteDesde), creadoPorUserId: actor.id,
      } });
      await recordTraceAudit({ entityType: 'ConceptoCosteoImporte', entityId: guardado.id, action: 'create', actor, after: guardado, comment: `Nueva versión nominal del concepto "${concepto.clave}".` }, tx);
      return this.serializarImporte(guardado);
    });
  }

  private serializarImporte(fila: { id: string; conceptoId: string; importeFijo: Prisma.Decimal | null; importeVariableUnitario: Prisma.Decimal | null; moneda: string; unidad: string; vigenteDesde: Date; createdAt: Date }) {
    return { ...fila, importeFijo: fila.importeFijo === null ? null : Number(fila.importeFijo), importeVariableUnitario: fila.importeVariableUnitario === null ? null : Number(fila.importeVariableUnitario), vigenteDesde: fila.vigenteDesde.toISOString(), createdAt: fila.createdAt.toISOString() };
  }

  async calcular(userId: string, companyId: string, query: PuntoCierreQuery) {
    await this.empresa(userId, companyId);
    const vigenteEn = query.vigenteEn ? new Date(query.vigenteEn) : new Date();
    const filas = await this.db.conceptoCosteo.findMany({ where: { companyId, deletedAt: null } });
    const claves = [...new Set(filas.map((f) => f.clave))];
    const resueltos = claves.map((clave) => resolverConceptoCosteo(clave, filas.map((f) => ({ ...f, rangoActividadDesde: f.rangoActividadDesde === null ? null : Number(f.rangoActividadDesde), rangoActividadHasta: f.rangoActividadHasta === null ? null : Number(f.rangoActividadHasta) }) as FilaConceptoCosteo), { structureId: query.structureId, periodId: query.periodId })).filter((v): v is NonNullable<typeof v> => v !== null);
    const importes = await this.db.conceptoCosteoImporte.findMany({ where: { companyId, conceptoId: { in: resueltos.map((c) => c.id) }, vigenteDesde: { lte: vigenteEn } }, orderBy: [{ vigenteDesde: 'desc' }, { createdAt: 'desc' }] });
    const importePorConcepto = new Map<string, typeof importes[number]>();
    for (const importe of importes) if (!importePorConcepto.has(importe.conceptoId)) importePorConcepto.set(importe.conceptoId, importe);
    const monedas = new Set(importes.map((i) => i.moneda));
    const unidades = new Set(importes.map((i) => i.unidad));
    const faltantes: Array<{ desdeHorizonte: number; motivo: string }> = [];
    const conceptos: ConceptoErogableValorizado[] = [];
    for (const concepto of resueltos) {
      const importe = importePorConcepto.get(concepto.id);
      const etiqueta = concepto.descripcion ?? concepto.clave;
      const desdeHorizonte = concepto.erogable === false
        ? Number.POSITIVE_INFINITY
        : concepto.erogable === true && concepto.horizonteErogableMeses !== null
          ? concepto.horizonteErogableMeses
          : 0;
      if (!importe) { faltantes.push({ desdeHorizonte, motivo: `Falta importe para el concepto "${etiqueta}".` }); continue; }
      const base = { clave: concepto.clave, etiqueta, erogable: concepto.erogable, horizonteErogableMeses: concepto.horizonteErogableMeses };
      if (concepto.comportamientoVolumen === 'FIJO' && importe.importeFijo !== null) conceptos.push({ ...base, comportamientoVolumen: 'FIJO', importe: Number(importe.importeFijo) });
      else if (concepto.comportamientoVolumen === 'VARIABLE' && importe.importeVariableUnitario !== null) conceptos.push({ ...base, comportamientoVolumen: 'VARIABLE', importeUnitario: Number(importe.importeVariableUnitario) });
      else if (concepto.comportamientoVolumen === 'SEMIFIJO' && importe.importeFijo !== null && importe.importeVariableUnitario !== null) conceptos.push({ ...base, comportamientoVolumen: 'SEMIFIJO', importeFijo: Number(importe.importeFijo), importeVariableUnitario: Number(importe.importeVariableUnitario) });
      else faltantes.push({ desdeHorizonte, motivo: `Falta la porción exigida por el comportamiento del concepto "${etiqueta}".` });
    }
    if (monedas.size > 1) faltantes.push({ desdeHorizonte: 0, motivo: 'Los importes vigentes tienen monedas distintas.' });
    if (unidades.size > 1) faltantes.push({ desdeHorizonte: 0, motivo: 'Los importes vigentes tienen unidades distintas.' });
    const contexto = { basadoEn: resueltos.map((c) => ({ clave: c.clave, etiqueta: c.descripcion ?? c.clave })) };
    let horizontes = calcularPuntosCierre({ precioUnitario: query.precioUnitario, horizontesMeses: query.horizontes, conceptos, contexto, puntoEquilibrioEconomico: query.puntoEquilibrioEconomico, unidadesActuales: query.actividad ?? null });
    horizontes = horizontes.map((h) => {
      const motivos = faltantes.filter((f) => f.desdeHorizonte <= h.horizonteMeses).map((f) => f.motivo);
      return motivos.length === 0 ? h : { ...h, valor: null, motivoSinEquilibrio: motivos.join(' '), costosFijosErogables: null, costoVariableUnitarioErogable: null, contribucionMarginalFinanciera: null, situacion: null };
    });
    const respuestaHorizontes = horizontes.map((h) => ({ ...h, basadoEn: [...h.basadoEn], conceptosIncluidos: [...h.conceptosIncluidos], conceptosExcluidos: [...h.conceptosExcluidos] }));
    return { moneda: monedas.size === 1 ? [...monedas][0]! : null, unidad: unidades.size === 1 ? [...unidades][0]! : null, nominal: true as const, precioUnitario: query.precioUnitario, puntoEquilibrioEconomico: query.puntoEquilibrioEconomico, actividad: query.actividad ?? null, importeVersionIds: [...importePorConcepto.values()].map((i) => i.id), horizontes: respuestaHorizontes };
  }
}
