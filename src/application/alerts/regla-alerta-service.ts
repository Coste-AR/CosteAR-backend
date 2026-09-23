import { withTenant } from '../../infrastructure/database/prisma.js';
import { ConflictError, NotFoundError } from '../../domain/errors/domain-error.js';
import {
  evaluarReglaDetallada,
  type ReglaAlerta,
} from '../../domain/alertas/reglas-alerta.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import type {
  EvaluarReglaAlertaInput,
  ReglaAlertaCreateInput,
  ReglaAlertaUpdateInput,
} from '../../shared/schemas/regla-alerta.schema.js';
import { EmailService } from '../../infrastructure/email/email-service.js';
import {
  CATEGORY_BY_INDUSTRY,
  CATEGORIA_AVICOLA_POSTURA,
  PAQUETE_AVICOLA_POSTURA,
} from '../operacion/paquete-avicola.js';
import { PaqueteRubroService } from '../operacion/paquete-rubro-service.js';

interface IndicadorAlertaConfigurado {
  indicador: string;
  etiqueta: string;
  unidad: string;
}

function catalogoDesdePaquete(value: unknown): IndicadorAlertaConfigurado[] | null {
  if (!Array.isArray(value)) return null;
  const catalogo = value.filter((item): item is IndicadorAlertaConfigurado => {
    if (!item || typeof item !== 'object') return false;
    const candidato = item as Partial<IndicadorAlertaConfigurado>;
    return typeof candidato.indicador === 'string'
      && typeof candidato.etiqueta === 'string'
      && typeof candidato.unidad === 'string';
  });
  return catalogo.length > 0 ? catalogo : null;
}

export class ReglaAlertaService {
  constructor(
    private readonly email?: Pick<EmailService, 'sendIndicatorAlert'>,
  ) {}

  private async companyDe(userId: string, companyId: string) {
    const company = await withTenant(userId, (tx) =>
      tx.company.findFirst({
        where: { id: companyId, userId, deletedAt: null },
        include: { user: { select: { email: true } } },
      }),
    );
    if (!company) throw new NotFoundError('Negocio no encontrado');
    return company;
  }

  async catalogo(userId: string, companyId: string) {
    const company = await this.companyDe(userId, companyId);
    const category = company.industry
      ? CATEGORY_BY_INDUSTRY[company.industry as keyof typeof CATEGORY_BY_INDUSTRY]
      : undefined;
    if (!category) return [];

    const paquete = await new PaqueteRubroService().resolve(userId, category, { companyId });
    const configurados = catalogoDesdePaquete(paquete.alertRules)
      ?? (category === CATEGORIA_AVICOLA_POSTURA
        ? catalogoDesdePaquete(PAQUETE_AVICOLA_POSTURA.alertRules) ?? []
        : []);
    return configurados.map(({ indicador, etiqueta, unidad }) => ({
      clave: indicador,
      etiqueta,
      unidad,
    }));
  }

  private async validarAlcance(
    userId: string,
    companyId: string,
    input: { structureId?: string | null; unidadId?: string | null },
  ) {
    if (input.structureId) {
      const structure = await withTenant(userId, (tx) =>
        tx.costStructure.findFirst({
          where: { id: input.structureId!, companyId, userId, deletedAt: null },
          select: { id: true },
        }),
      );
      if (!structure) throw new NotFoundError('Estructura de costos no encontrada');
    }
    if (input.unidadId) {
      const unidad = await withTenant(userId, (tx) =>
        tx.unidadMedida.findFirst({
          where: { id: input.unidadId!, companyId, deletedAt: null },
          select: { id: true },
        }),
      );
      if (!unidad) throw new NotFoundError('Unidad de medida no encontrada');
    }
  }

  async listar(userId: string, companyId: string, structureId?: string) {
    await this.companyDe(userId, companyId);
    if (structureId) await this.validarAlcance(userId, companyId, { structureId });
    return withTenant(userId, (tx) =>
      tx.reglaAlerta.findMany({
        where: { companyId, deletedAt: null, ...(structureId ? { structureId } : {}) },
        include: { unidad: true },
        orderBy: [{ severidad: 'desc' }, { indicador: 'asc' }],
      }),
    );
  }

  async crear(
    userId: string,
    companyId: string,
    input: ReglaAlertaCreateInput,
    actor: TraceActor,
  ) {
    await this.companyDe(userId, companyId);
    const structureId = input.structureId ?? null;
    const unidadId = input.unidadId ?? null;
    await this.validarAlcance(userId, companyId, { structureId, unidadId });

    return withTenant(userId, async (tx) => {
      const existente = await tx.reglaAlerta.findFirst({
        where: { companyId, structureId, indicador: input.indicador, deletedAt: null },
        select: { id: true },
      });
      if (existente) throw new ConflictError('Ya existe una regla para ese indicador y alcance');

      const creada = await tx.reglaAlerta.create({
        data: { companyId, userId, ...input, structureId, unidadId },
        include: { unidad: true },
      });
      await recordTraceAudit(
        {
          entityType: 'ReglaAlerta',
          entityId: creada.id,
          action: 'create',
          actor,
          after: creada,
          comment: `Regla de alerta creada para ${creada.indicador}.`,
        },
        tx,
      );
      return creada;
    });
  }

  async actualizar(
    userId: string,
    companyId: string,
    id: string,
    input: ReglaAlertaUpdateInput,
    actor: TraceActor,
  ) {
    await this.companyDe(userId, companyId);
    await this.validarAlcance(userId, companyId, { unidadId: input.unidadId });
    return withTenant(userId, async (tx) => {
      const existente = await tx.reglaAlerta.findFirst({
        where: { id, companyId, userId, deletedAt: null },
        include: { unidad: true },
      });
      if (!existente) throw new NotFoundError('Regla de alerta no encontrada');

      if (input.indicador && input.indicador !== existente.indicador) {
        const repetida = await tx.reglaAlerta.findFirst({
          where: {
            companyId,
            structureId: existente.structureId,
            indicador: input.indicador,
            deletedAt: null,
            id: { not: id },
          },
          select: { id: true },
        });
        if (repetida) throw new ConflictError('Ya existe una regla para ese indicador y alcance');
      }

      const actualizada = await tx.reglaAlerta.update({
        where: { id },
        data: input,
        include: { unidad: true },
      });
      await recordTraceAudit(
        {
          entityType: 'ReglaAlerta',
          entityId: id,
          action: 'update',
          actor,
          before: existente,
          after: actualizada,
          comment: `Regla de alerta actualizada para ${actualizada.indicador}.`,
        },
        tx,
      );
      return actualizada;
    });
  }

  async evaluar(
    userId: string,
    companyId: string,
    id: string,
    input: EvaluarReglaAlertaInput,
    actor: TraceActor,
  ) {
    const company = await this.companyDe(userId, companyId);
    const evaluacion = await withTenant(userId, async (tx) => {
      const fila = await tx.reglaAlerta.findFirst({
        where: { id, companyId, userId, deletedAt: null },
        include: { unidad: true },
      });
      if (!fila) throw new NotFoundError('Regla de alerta no encontrada');

      const regla: ReglaAlerta = {
        id: fila.id,
        indicador: fila.indicador,
        descripcion: fila.descripcion,
        condicion: fila.condicion,
        umbral: Number(fila.umbral),
        unidad: fila.unidad?.codigo ?? null,
        lecturasSostenidas: fila.lecturasSostenidas,
        severidad: fila.severidad,
        activa: fila.activa,
      };
      const resultado = evaluarReglaDetallada(
        regla,
        input.lecturas.map((lectura) => ({ ...lectura, fecha: new Date(lectura.fecha) })),
      );
      const metadatos = {
        indicador: fila.indicador,
        indicadorEtiqueta: fila.descripcion,
        severidad: fila.severidad,
        unidadValor: fila.unidad?.codigo ?? null,
        unidadUmbral: fila.unidad?.codigo ?? null,
      };
      if (resultado.estado === 'NO_EVALUABLE') {
        const alerta = await tx.alert.create({
          data: {
            userId,
            companyId,
            costStructureId: fila.structureId,
            type: 'INDICADOR_FISICO',
            message: resultado.motivo,
            threshold: Number(fila.umbral),
            actualValue: null,
            motivoNoEvaluada: resultado.motivo,
            ...metadatos,
          },
        });
        await recordTraceAudit(
          {
            entityType: 'Alert',
            entityId: alerta.id,
            action: 'create',
            actor,
            after: alerta,
            comment: `La regla ${fila.indicador} no pudo evaluarse y dejó el motivo disponible.`,
          },
          tx,
        );
        return { ...resultado, alerta };
      }
      if (resultado.estado !== 'ALERTA') return { ...resultado, alerta: null };

      const alerta = await tx.alert.create({
        data: {
          userId,
          companyId,
          costStructureId: fila.structureId,
          type: 'INDICADOR_FISICO',
          message: resultado.hallazgo.mensaje,
          threshold: resultado.hallazgo.umbral,
          actualValue: resultado.hallazgo.valor,
          motivoNoEvaluada: null,
          ...metadatos,
        },
      });
      await recordTraceAudit(
        {
          entityType: 'Alert',
          entityId: alerta.id,
          action: 'create',
          actor,
          after: alerta,
          comment: `La regla ${fila.indicador} generó una alerta ${fila.severidad}.`,
        },
        tx,
      );
      return { ...resultado, alerta };
    });

    if (evaluacion.estado !== 'ALERTA' || !evaluacion.alerta) return evaluacion;

    const regla = await withTenant(userId, (tx) =>
      tx.reglaAlerta.findFirst({
        where: { id, companyId, userId, deletedAt: null },
        select: { canal: true, destinatarios: true },
      }),
    );
    if (regla?.canal !== 'EMAIL') return { ...evaluacion, entrega: { canal: 'IN_APP' as const } };

    const destinatarios = regla.destinatarios.length > 0
      ? regla.destinatarios
      : [company.user.email];
    const email = this.email ?? new EmailService();
    try {
      await Promise.all(
        destinatarios.map((to) =>
          email.sendIndicatorAlert(to, company.name, evaluacion.hallazgo.mensaje),
        ),
      );
    } catch {
      return {
        ...evaluacion,
        entrega: {
          canal: 'EMAIL' as const,
          destinatarios: destinatarios.length,
          estado: 'FALLIDA' as const,
          motivo: 'La alerta quedó en la app, pero no se pudo enviar el email.',
        },
      };
    }
    const emailSentAt = new Date();
    await withTenant(userId, async (tx) => {
      const actualizada = await tx.alert.update({
        where: { id: evaluacion.alerta.id },
        data: { emailSentAt },
      });
      await recordTraceAudit(
        {
          entityType: 'Alert',
          entityId: actualizada.id,
          action: 'deliver',
          actor,
          before: evaluacion.alerta,
          after: actualizada,
          comment: `Alerta enviada por email a ${destinatarios.length} destinatario(s).`,
        },
        tx,
      );
    });
    return {
      ...evaluacion,
      entrega: {
        canal: 'EMAIL' as const,
        destinatarios: destinatarios.length,
        estado: 'ENVIADA' as const,
        emailSentAt,
      },
    };
  }
}
