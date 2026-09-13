import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import {
  definicionDe,
  definicionComportamientoDe,
  resolverParametro,
  resolverComportamiento,
  type ValorResuelto,
  type FilaParametro,
  type OrigenParametro,
} from '../../domain/parametros/parametros-costeo.js';
import type { SetParametroCosteoInput } from '../../shared/schemas/parametros-costeo.schema.js';
import { CATEGORY_BY_INDUSTRY } from '../operacion/paquete-avicola.js';
import { PaqueteRubroService } from '../operacion/paquete-rubro-service.js';
import { ModulosRubroService } from '../operacion/modulos-rubro-service.js';

interface OpcionParametro { valor: string; etiqueta: string }
interface ParametroPaquete {
  clave: string;
  descripcion: string;
  valor?: number;
  unidad?: string;
  seguro?: boolean;
  tipo?: 'texto' | 'unidad_gestion';
  opciones?: OpcionParametro[];
  propuestaModulo?: { valores: string[]; clave: string };
}

interface PreguntaTextoResuelta {
  clave: string;
  valor: string | null;
  descripcion: string;
  opciones: OpcionParametro[];
  origen: OrigenParametro;
  confirmado: boolean;
  propuestaModulo?: { valores: string[]; clave: string };
}

function esParametroPaquete(value: unknown): value is ParametroPaquete {
  if (!value || typeof value !== 'object') return false;
  const parametro = value as Partial<ParametroPaquete>;
  return typeof parametro.clave === 'string' && typeof parametro.descripcion === 'string' &&
    (parametro.valor === undefined || typeof parametro.valor === 'number') &&
    (parametro.tipo === undefined || parametro.tipo === 'texto' || parametro.tipo === 'unidad_gestion') &&
    (parametro.opciones === undefined || parametro.opciones.every((opcion) =>
      typeof opcion?.valor === 'string' && typeof opcion?.etiqueta === 'string'));
}

/**
 * PARÁMETROS DE COSTEO — el servicio que le faltaba al catálogo (issue #115).
 *
 * `src/domain/parametros/parametros-costeo.ts` tiene el catálogo y la cascada
 * de resolución hace tiempo: tabla, migración y RLS están, y nadie los leía ni
 * escribía. Este servicio es el cable. Bloqueaba a #92 (desperdicio) y a #116
 * (amortización del plantel), que necesitan `umbral_merma_normal_pct` y
 * `vida_util_lote_meses` respectivamente y hoy no tienen de dónde sacarlos.
 *
 * Reglas del repo que aplican: los registros se borran LÓGICAMENTE (DOM-01),
 * toda mutación deja su entrada de bitácora en la MISMA transacción (DOM-02),
 * los timestamps son del servidor (DOM-03) y el aislamiento entre empresas lo
 * garantiza RLS vía `withTenant` (DOM-07).
 */
export class ParametrosCosteoService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** Verifica que la empresa exista y sea de quien la pide. */
  private async companyDe(userId: string, companyId: string) {
    const company = await this.db.company.findFirst({ where: { id: companyId, userId } });
    if (!company) throw new NotFoundError('Empresa no encontrada');
    return company;
  }

  /** El paquete, y no el código del motor, decide qué se pregunta en cada rubro. */
  private async catalogoDe(userId: string, companyId: string, industry: string | null): Promise<ParametroPaquete[]> {
    const category = industry ? CATEGORY_BY_INDUSTRY[industry as keyof typeof CATEGORY_BY_INDUSTRY] : undefined;
    if (!category) return [];
    const paquete = await new PaqueteRubroService(this.db).resolve(userId, category, { companyId });
    return Array.isArray(paquete.seedParameters) ? paquete.seedParameters.filter(esParametroPaquete) : [];
  }

  private async preguntasActivas(userId: string, companyId: string): Promise<ParametroPaquete[]> {
    const company = await this.companyDe(userId, companyId);
    const [catalogo, modulos] = await Promise.all([
      this.catalogoDe(userId, companyId, company.industry),
      new ModulosRubroService(this.db).listar(userId, companyId),
    ]);
    const claves = new Set(modulos.filter((modulo) => modulo.estado === 'prendido').flatMap((modulo) => modulo.parametros));
    return catalogo.filter((parametro) => claves.has(parametro.clave));
  }

  /**
   * Si se pasa `structureId` o `periodId`, verifica que pertenezcan a la
   * empresa. Sin este chequeo, alguien podría leer o escribir un parámetro
   * "de" una estructura ajena solo adivinando su id.
   */
  private async validarAlcance(
    companyId: string,
    ctx: { structureId?: string | null; periodId?: string | null },
  ): Promise<void> {
    if (ctx.structureId) {
      const est = await this.db.costStructure.findFirst({
        where: { id: ctx.structureId, companyId },
      });
      if (!est) throw new NotFoundError('Estructura de costos no encontrada');
    }
    if (ctx.periodId) {
      const per = await this.db.costPeriod.findFirst({ where: { id: ctx.periodId, companyId } });
      if (!per) throw new NotFoundError('Período no encontrado');
    }
  }

  /** Todas las filas cargadas de una empresa, en la forma que consume `resolverParametro`. */
  private async filasDe(companyId: string): Promise<FilaParametro[]> {
    const filas = await this.db.parametroCosteo.findMany({
      where: { companyId, deletedAt: null },
    });
    return filas.map((f) => ({
      clave: f.clave,
      valorNum: f.valorNum === null ? null : Number(f.valorNum),
      valorTexto: f.valorTexto,
      periodId: f.periodId,
      structureId: f.structureId,
      confirmado: f.confirmado,
    }));
  }

  private async filasComportamientoDe(companyId: string) {
    return this.db.parametroCosteo.findMany({
      where: { companyId, deletedAt: null },
      select: {
        clave: true,
        comportamientoVolumen: true,
        periodId: true,
        structureId: true,
        confirmado: true,
        clasificadoPorUserId: true,
        clasificadoEn: true,
      },
    });
  }

  /**
   * Resuelve un parámetro puntual con la cascada período → estructura → empresa
   * → default del catálogo. El resultado dice de qué nivel salió (`origen`) y
   * si alguien lo confirmó — un default no confirmado no es un dato.
   */
  async resolver(
    userId: string,
    companyId: string,
    clave: string,
    ctx: { structureId?: string | null; periodId?: string | null } = {},
  ): Promise<ValorResuelto | PreguntaTextoResuelta | ReturnType<typeof resolverComportamiento>> {
    const company = await this.companyDe(userId, companyId);
    const pregunta = (await this.catalogoDe(userId, companyId, company.industry)).find((item) => item.clave === clave);
    if (pregunta?.tipo) {
      const visible = await this.listar(userId, companyId, ctx);
      const respuesta = visible.find((item) => item.clave === clave);
      if (!respuesta) throw new NotFoundError(`No existe el parámetro de costeo "${clave}"`);
      return respuesta;
    }
    const definicion = definicionDe(clave);
    const definicionComportamiento = definicionComportamientoDe(clave);
    if (!definicion && !definicionComportamiento) {
      throw new NotFoundError(`No existe el parámetro de costeo "${clave}"`);
    }
    await this.validarAlcance(companyId, ctx);
    if (definicionComportamiento) {
      return resolverComportamiento(clave, await this.filasComportamientoDe(companyId), ctx);
    }
    return resolverParametro(clave, await this.filasDe(companyId), ctx);
  }

  /**
   * Todo el catálogo, resuelto para una empresa. Es lo que ve el costista: para
   * cada clave, el valor vigente y si lo puso el sistema o lo confirmó el
   * cliente.
   */
  async listar(
    userId: string,
    companyId: string,
    ctx: { structureId?: string | null; periodId?: string | null } = {},
  ): Promise<Array<ValorResuelto | PreguntaTextoResuelta>> {
    const company = await this.companyDe(userId, companyId);
    await this.validarAlcance(companyId, ctx);
    const filas = await this.filasDe(companyId);
    const preguntas = await this.preguntasActivas(userId, companyId);
    return Promise.all(preguntas.map(async (pregunta) => {
      if (!pregunta.tipo) {
        // El motor conoce cómo resolver la cascada numérica; los metadatos que
        // se exhiben vinieron del paquete y no del catálogo del código.
        const resuelto = resolverParametro(pregunta.clave, filas, ctx);
        return {
          ...resuelto,
          descripcion: pregunta.descripcion,
          unidad: pregunta.unidad ?? null,
          valorDefault: pregunta.valor!,
          seguro: pregunta.seguro ?? false,
        };
      }
      if (pregunta.tipo === 'unidad_gestion') {
        const unidad = company.unidadGestionId
          ? await this.db.unidadMedida.findFirst({ where: { id: company.unidadGestionId, companyId, deletedAt: null } })
          : null;
        return {
          clave: pregunta.clave, valor: unidad?.codigo ?? null, descripcion: pregunta.descripcion,
          opciones: pregunta.opciones ?? [], origen: unidad ? 'empresa' : 'default', confirmado: Boolean(unidad),
          ...(pregunta.propuestaModulo ? { propuestaModulo: pregunta.propuestaModulo } : {}),
        };
      }
      const fila = filas.find((item) => item.clave === pregunta.clave && item.valorTexto !== null && item.periodId === null && item.structureId === null);
      return {
        clave: pregunta.clave, valor: fila?.valorTexto ?? null, descripcion: pregunta.descripcion,
        opciones: pregunta.opciones ?? [], origen: fila ? 'empresa' : 'default', confirmado: fila?.confirmado ?? false,
        ...(pregunta.propuestaModulo ? { propuestaModulo: pregunta.propuestaModulo } : {}),
      };
    }));
  }

  /**
   * Carga o actualiza el valor de un parámetro en el nivel que se indique
   * (empresa por default; estructura o período si se pasan). `confirmado` lo
   * decide quien llama: cargar un valor para poder avanzar NO es lo mismo que
   * el cliente confirmándolo (REV-03), y el resultado tiene que poder decir
   * cuál de las dos cosas fue.
   */
  async set(
    userId: string,
    companyId: string,
    clave: string,
    input: SetParametroCosteoInput,
    actor: TraceActor,
  ) {
    const company = await this.companyDe(userId, companyId);
    const definicion = definicionDe(clave);
    const definicionComportamiento = definicionComportamientoDe(clave);
    // Los parámetros numéricos ya tienen una definición pura que consume el
    // motor. Sólo las preguntas declarativas necesitan consultar el paquete.
    const catalogo = definicion || definicionComportamiento
      ? []
      : await this.catalogoDe(userId, companyId, company.industry);
    const pregunta = catalogo.find((item) => item.clave === clave);
    if (!pregunta && !definicion && !definicionComportamiento) {
      throw new UnprocessableEntityError(`No existe el parámetro de costeo "${clave}"`, {
        field: 'clave',
      });
    }
    const structureId = input.structureId ?? null;
    const periodId = input.periodId ?? null;
    await this.validarAlcance(companyId, { structureId, periodId });

    if (pregunta?.tipo) {
      if (input.valorTexto === undefined) {
        throw new UnprocessableEntityError(`La pregunta "${clave}" requiere una respuesta de opción.`, { field: 'valorTexto' });
      }
      if (!pregunta.opciones?.some((opcion) => opcion.valor === input.valorTexto)) {
        throw new UnprocessableEntityError(`"${input.valorTexto}" no es una opción válida para "${clave}".`, { field: 'valorTexto' });
      }
      if (pregunta.tipo === 'unidad_gestion') {
        return withTenant(userId, async (tx) => {
          const unidad = await tx.unidadMedida.findFirst({
            where: { companyId, codigo: input.valorTexto, deletedAt: null },
          });
          if (!unidad) {
            throw new UnprocessableEntityError(`La empresa no tiene una unidad "${input.valorTexto}" disponible para gestión.`, { field: 'valorTexto' });
          }
          const actualizada = await tx.company.update({ where: { id: companyId }, data: { unidadGestionId: unidad.id } });
          await recordTraceAudit({
            entityType: 'Company', entityId: companyId, action: 'update', actor,
            before: { unidadGestionId: company.unidadGestionId }, after: { unidadGestionId: unidad.id },
            comment: `Unidad de gestión seleccionada: ${unidad.codigo}.`,
          }, tx);
          return actualizada;
        });
      }
    }

    if (definicion && input.valor === undefined) {
      throw new UnprocessableEntityError(`El parámetro "${clave}" requiere un valor numérico.`, { field: 'valor' });
    }
    if (definicionComportamiento && input.comportamientoVolumen === undefined) {
      throw new UnprocessableEntityError(
        `La clasificación "${clave}" requiere un comportamiento frente al volumen.`,
        { field: 'comportamientoVolumen' },
      );
    }

    return withTenant(userId, async (tx) => {
      const existente = await tx.parametroCosteo.findFirst({
        where: { companyId, structureId, periodId, clave, deletedAt: null },
      });

      const esComportamiento = Boolean(definicionComportamiento);
      const clasificacion = input.comportamientoVolumen;
      const data: Prisma.ParametroCosteoUncheckedCreateInput = {
        companyId,
        userId,
        structureId,
        periodId,
        clave,
        valorNum: esComportamiento ? null : input.valor ?? null,
        valorTexto: pregunta?.tipo ? input.valorTexto! : null,
        // Las respuestas cerradas son una declaración explícita; no pueden
        // quedar como propuesta sin confirmar por un flag del cliente.
        confirmado: pregunta?.tipo ? true : input.confirmado,
        descripcion: definicionComportamiento?.descripcion ?? pregunta?.descripcion ?? definicion!.descripcion,
        comportamientoVolumen: clasificacion ?? null,
        // Proponer no es confirmar: la semilla no atribuye una decisión a una
        // persona. Una edición explícita sí deja el autor y reloj del servidor.
        clasificadoPorUserId: esComportamiento ? actor.id : null,
        clasificadoEn: esComportamiento ? new Date() : null,
      };

      const guardado = existente
        ? await tx.parametroCosteo.update({ where: { id: existente.id }, data })
        : await tx.parametroCosteo.create({ data });

      // DOM-02: la bitácora va en la MISMA transacción. Si falla, no queda un
      // valor de negocio cambiado sin rastro de quién lo cargó.
      await recordTraceAudit(
        {
          entityType: 'ParametroCosteo',
          entityId: guardado.id,
          action: existente ? 'update' : 'create',
          actor,
          before: existente ?? undefined,
          after: guardado,
          comment: esComportamiento
            ? `Clasificación "${clave}" ${input.confirmado ? 'confirmada' : 'cargada sin confirmar'}: ${clasificacion}`
            : `Parámetro "${clave}" ${input.confirmado ? 'confirmado' : 'cargado sin confirmar'}: ${input.valor ?? input.valorTexto}`,
        },
        tx,
      );

      return guardado;
    });
  }

  /**
   * Borra sólo el override del nivel solicitado. La ausencia es idempotente:
   * la cascada ya resolvía desde arriba y no hay una decisión que auditar.
   */
  async delete(
    userId: string,
    companyId: string,
    clave: string,
    ctx: { structureId?: string | null; periodId?: string | null } = {},
    actor: TraceActor,
  ) {
    const definicion = definicionDe(clave);
    const definicionComportamiento = definicionComportamientoDe(clave);
    if (!definicion && !definicionComportamiento) {
      throw new NotFoundError(`No existe el parámetro de costeo "${clave}"`);
    }
    await this.companyDe(userId, companyId);
    await this.validarAlcance(companyId, ctx);

    await withTenant(userId, async (tx) => {
      const existente = await tx.parametroCosteo.findFirst({
        where: {
          companyId,
          structureId: ctx.structureId ?? null,
          periodId: ctx.periodId ?? null,
          clave,
          deletedAt: null,
        },
      });
      if (!existente) return;

      const eliminado = await tx.parametroCosteo.update({
        where: { id: existente.id },
        data: { deletedAt: new Date() },
      });
      await recordTraceAudit(
        {
          entityType: 'ParametroCosteo',
          entityId: existente.id,
          action: 'delete',
          actor,
          before: existente,
          after: eliminado,
          comment: `Override del parámetro "${clave}" eliminado; vuelve a resolverse por cascada.`,
        },
        tx,
      );
    });

    return this.resolver(userId, companyId, clave, ctx);
  }
}
