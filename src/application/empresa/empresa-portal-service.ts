import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { hashPassword } from '../../infrastructure/crypto/password.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../../domain/errors/domain-error.js';
import { EmailService } from '../../infrastructure/email/email-service.js';
import { GroqService } from '../../infrastructure/ai/groq-service.js';
import { randomBytes } from 'node:crypto';
import { ingestDataEntry } from '../ingest/ingest-data-entry.js';
import { SystemAlertService } from '../system/system-alert-service.js';

/**
 * Gestión de operadores de empresa (usuarios EMPRESA_OPERATOR).
 *
 * Flujo revisado (multi-empresa + invite codes):
 *
 *  CASO A — email nuevo (nunca tuvo cuenta):
 *   1. Se crea un User con rol EMPRESA_OPERATOR + mustChangePassword = true.
 *   2. Se crea OperatorMembership + OperatorInvite (ya aceptada automáticamente).
 *   3. Se envía email con credenciales temporales + código de invitación.
 *   4. Al entrar, el router redirige a cambiar contraseña.
 *
 *  CASO B — email pertenece a un EMPRESA_OPERATOR existente:
 *   1. Se crea OperatorMembership a la nueva empresa (si no existía).
 *   2. Se crea OperatorInvite con status PENDING y código legible.
 *   3. Se envía email con SOLO el código de invitación (sin contraseña).
 *   4. El operador acepta el código desde su dashboard.
 *
 *  CASO C — email pertenece a un COSTISTA:
 *   Se rechaza con error explicativo.
 */
export class EmpresaPortalService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly emailService: EmailService = new EmailService(),
    private readonly groq: GroqService = new GroqService(),
    private readonly alerts: SystemAlertService = new SystemAlertService(),
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private generateInviteCode(companyName: string): string {
    const prefix = companyName.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6).padEnd(3, 'X');
    const suffix = randomBytes(3).toString('hex').toUpperCase();
    return `${prefix}-${suffix}`;
  }

  private async getOrCreateConnection(companyId: string, costistId: string) {
    const existing = await this.db.empresaConnection.findUnique({
      where: { companyId_costistId: { companyId, costistId } },
    });
    if (existing) return existing;
    return this.db.empresaConnection.create({ data: { companyId, costistId } });
  }

  // ── Costista: invitar operador ─────────────────────────────────────────────

  async inviteOperator(
    companyId: string,
    costistId: string,
    operatorName: string,
    operatorEmail: string,
  ): Promise<{
    email: string;
    tempPassword?: string;
    inviteCode: string;
    isNewUser: boolean;
    emailSent: boolean;
  }> {
    const normalizedEmail = operatorEmail.toLowerCase().trim();

    const company = await this.db.company.findFirst({ where: { id: companyId, userId: costistId } });
    if (!company) throw new NotFoundError('Empresa no encontrada');

    const connection = await this.getOrCreateConnection(companyId, costistId);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días
    const inviteCode = this.generateInviteCode(company.name);

    // ¿Ya existe un usuario con ese email?
    const existingUser = await this.db.user.findUnique({ where: { email: normalizedEmail } });

    if (existingUser) {
      // CASO B: ya existe — solo crear invitación + membership
      const alreadyMember = await this.db.operatorMembership.findUnique({
        where: { operatorId_connectionId: { operatorId: existingUser.id, connectionId: connection.id } },
      });
      if (alreadyMember?.isActive) {
        throw new ConflictError(`${normalizedEmail} ya es operador activo de esta empresa.`);
      }

      // Cancelar invitaciones anteriores pendientes para evitar acumulación
      await this.db.operatorInvite.updateMany({
        where: {
          connectionId: connection.id,
          inviteeEmail: normalizedEmail,
          status: 'PENDING',
        },
        data: { status: 'REVOKED' },
      });

      await this.db.operatorInvite.create({
        data: {
          code: inviteCode,
          connectionId: connection.id,
          costistId,
          inviteeEmail: normalizedEmail,
          inviteeId: existingUser.id,
          status: 'PENDING',
          expiresAt,
        },
      });

      let emailSent = true;
      try {
        await this.emailService.sendOperatorInviteCode(
          normalizedEmail,
          existingUser.name,
          company.name,
          inviteCode,
        );
      } catch (err) {
        emailSent = false;
        console.warn('[empresa-portal] Email de código de invitación no enviado:', err);
        await this.alerts.create({
          source: 'empresa-portal',
          level: 'warning',
          message: `No se pudo enviar el email de código de invitación a ${normalizedEmail} (código: ${inviteCode}). Pasáselo manualmente.`,
        });
      }

      return { email: normalizedEmail, inviteCode, isNewUser: false, emailSent };
    }

    // CASO A: usuario nuevo
    const tempPassword = randomBytes(6).toString('hex');
    const passwordHash = await hashPassword(tempPassword);

    const newUser = await this.db.user.create({
      data: {
        name: operatorName,
        email: normalizedEmail,
        passwordHash,
        role: 'EMPRESA_OPERATOR',
        mustChangePassword: true,
        onboardedAt: new Date(),
      },
    });

    // Membership activa inmediata (aceptó implícitamente)
    await this.db.operatorMembership.create({
      data: { operatorId: newUser.id, connectionId: connection.id, isActive: true },
    });

    // Invitación ya aceptada (registro histórico)
    await this.db.operatorInvite.create({
      data: {
        code: inviteCode,
        connectionId: connection.id,
        costistId,
        inviteeEmail: normalizedEmail,
        inviteeId: newUser.id,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        expiresAt,
      },
    });

    let emailSent = true;
    try {
      await this.emailService.sendOperatorInvite(
        normalizedEmail,
        operatorName,
        company.name,
        tempPassword,
        inviteCode,
      );
    } catch (err) {
      emailSent = false;
      console.warn('[empresa-portal] Email de invitación no enviado:', err);
      await this.alerts.create({
        source: 'empresa-portal',
        level: 'warning',
        message: `No se pudo enviar el email de invitación a ${normalizedEmail} (código: ${inviteCode}). Pasáselo manualmente.`,
      });
    }

    return { email: normalizedEmail, tempPassword, inviteCode, isNewUser: true, emailSent };
  }

  // ── Operador: aceptar invitación por código ────────────────────────────────

  async acceptInvite(operatorId: string, code: string): Promise<{ companyName: string }> {
    const invite = await this.db.operatorInvite.findUnique({
      where: { code },
      include: { connection: { include: { company: true } } },
    });

    if (!invite || invite.status !== 'PENDING') {
      throw new NotFoundError('Código de invitación inválido o ya utilizado.');
    }
    if (invite.expiresAt < new Date()) {
      throw new ForbiddenError('El código de invitación venció. Pedile uno nuevo al costista.');
    }
    if (invite.inviteeEmail !== (await this.db.user.findUnique({ where: { id: operatorId }, select: { email: true } }))?.email) {
      throw new ForbiddenError('Este código no corresponde a tu email.');
    }

    // Crear membership si no existe
    await this.db.operatorMembership.upsert({
      where: { operatorId_connectionId: { operatorId, connectionId: invite.connectionId } },
      create: { operatorId, connectionId: invite.connectionId, isActive: true },
      update: { isActive: true },
    });

    await this.db.operatorInvite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date(), inviteeId: operatorId },
    });

    return { companyName: invite.connection.company.name };
  }

  // ── Costista: listar y revocar ─────────────────────────────────────────────

  async listOperators(companyId: string, costistId: string) {
    const connection = await this.db.empresaConnection.findUnique({
      where: { companyId_costistId: { companyId, costistId } },
    });
    if (!connection) return [];

    const memberships = await this.db.operatorMembership.findMany({
      where: { connectionId: connection.id },
      include: { operator: { select: { id: true, name: true, email: true, createdAt: true } } },
      orderBy: { joinedAt: 'desc' },
    });

    return memberships.map((m) => ({
      id: m.operator.id,
      name: m.operator.name,
      email: m.operator.email,
      isActive: m.isActive,
      createdAt: m.operator.createdAt,
    }));
  }

  async revokeOperator(operatorId: string, costistId: string) {
    const membership = await this.db.operatorMembership.findFirst({
      where: {
        operatorId,
        connection: { costistId },
      },
    });
    if (!membership) throw new NotFoundError('Operador no encontrado en ninguna de tus empresas');

    // Eliminar la membresía para liberar la relación
    await this.db.operatorMembership.delete({
      where: { id: membership.id },
    });

    // Verificar si queda alguna membresía para este usuario
    const remaining = await this.db.operatorMembership.count({
      where: { operatorId },
    });

    if (remaining === 0) {
      const user = await this.db.user.findUnique({
        where: { id: operatorId },
        select: { role: true },
      });
      // Si era solo operador y ya no tiene empresas, borrar la cuenta completamente para liberar el email
      if (user && user.role === 'EMPRESA_OPERATOR') {
        await this.db.refreshToken.deleteMany({ where: { userId: operatorId } });
        await this.db.passwordReset.deleteMany({ where: { userId: operatorId } });
        await this.db.user.delete({
          where: { id: operatorId },
        });
      }
    }
  }

  // ── Costista: resetear contraseña de un operador ──────────────────────────
  // Genera una nueva contraseña temporal y devuelve las credenciales al costista
  // para que las comparta por cualquier medio (WhatsApp, etc.).
  // No requiere email funcionando.

  async resetOperatorPassword(operatorId: string, costistId: string): Promise<{ email: string; tempPassword: string }> {
    // Verificar que el operador pertenece a alguna empresa del costista
    const membership = await this.db.operatorMembership.findFirst({
      where: { operatorId, connection: { costistId } },
      include: { operator: { select: { id: true, email: true, role: true } } },
    });
    if (!membership) throw new NotFoundError('Operador no encontrado en tus empresas');
    if (membership.operator.role !== 'EMPRESA_OPERATOR') throw new ForbiddenError('Solo se puede resetear contraseña de operadores');

    const tempPassword = randomBytes(6).toString('hex');
    const passwordHash = await hashPassword(tempPassword);

    await this.db.user.update({
      where: { id: operatorId },
      data: { passwordHash, mustChangePassword: true },
    });

    // Invalidar todas las sesiones activas del operador
    await this.db.refreshToken.updateMany({
      where: { userId: operatorId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { email: membership.operator.email, tempPassword };
  }

  // ── Operador: listar sus empresas ──────────────────────────────────────────

  async listMyCompanies(operatorId: string) {
    return this.db.operatorMembership.findMany({
      where: { operatorId, isActive: true },
      include: {
        connection: {
          include: {
            company: { select: { id: true, name: true, industry: true } },
            // Costista que invitó / es dueño de la empresa: se muestra en el portal.
            costist: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  // ── Operador: subir documento ──────────────────────────────────────────────

  async submitDocument(
    operatorId: string,
    input: {
      rawContent: string;
      sourceType: 'TEXT' | 'PDF' | 'IMAGE';
      connectionId?: string;
      costStructureId?: string;
      fileName?: string;
      fileData?: string;
      fileMimeType?: string;
    },
  ) {
    const memberships = await this.db.operatorMembership.findMany({
      where: { operatorId, isActive: true },
      include: { connection: true },
    });

    if (memberships.length === 0) {
      throw new ForbiddenError('No tenés acceso activo a ninguna empresa.');
    }

    let membership = memberships[0]!;
    if (input.connectionId) {
      const found = memberships.find((m) => m.connectionId === input.connectionId);
      if (!found) throw new ForbiddenError('No tenés acceso a esa empresa.');
      membership = found;
    } else if (memberships.length > 1 && !input.connectionId) {
      throw new ForbiddenError('Tenés acceso a varias empresas. Indicá a cuál querés enviar.');
    }

    const costistId = membership.connection.costistId;
    const companyId = membership.connection.companyId;

    // ── Validar el producto destino (aislamiento de datos) ─────────────────────
    // Si el operador eligió una estructura/producto, debe pertenecer a ESTA empresa
    // y no estar borrada. El dato quedará atado a ese producto.
    let costStructureId: string | null = null;
    if (input.costStructureId) {
      const structure = await this.db.costStructure.findFirst({
        where: { id: input.costStructureId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!structure) {
        throw new ForbiddenError('El producto seleccionado no pertenece a esta empresa.');
      }
      costStructureId = structure.id;
    }

    // ── Ingesta: análisis IA + dedup + clasificación + persistencia ────────────
    // Camino compartido con `/datos/submit` y el webhook de WhatsApp para que
    // ninguna entrada llegue al costista sin ClassificationAudit.
    return ingestDataEntry(
      {
        connectionId: membership.connectionId,
        costistId,
        companyId,
        rawContent: input.rawContent,
        sourceType: input.sourceType,
        costStructureId,
        fileName: input.fileName,
        fileData: input.fileData,
        fileMimeType: input.fileMimeType,
      },
      { db: this.db, groq: this.groq, alerts: this.alerts },
    );
  }

  // ── Operador: historial de envíos ──────────────────────────────────────────

  /** Estructuras de costos (productos) de la empresa de una conexión a la que el
   *  operador tiene acceso activo. Para el desplegable del portal. */
  async listCompanyStructures(operatorId: string, connectionId: string) {
    const membership = await this.db.operatorMembership.findFirst({
      where: { operatorId, connectionId, isActive: true },
      include: { connection: { select: { companyId: true } } },
    });
    if (!membership) throw new ForbiddenError('No tenés acceso a esa empresa.');

    return this.db.costStructure.findMany({
      where: { companyId: membership.connection.companyId, deletedAt: null },
      orderBy: { period: 'desc' },
      select: { id: true, productName: true, period: true, status: true },
    });
  }

  async listMySubmissions(operatorId: string, connectionId?: string, costStructureId?: string) {
    const memberships = await this.db.operatorMembership.findMany({
      where: { operatorId, isActive: true },
      select: { connectionId: true },
    });
    if (memberships.length === 0) return [];

    const connectionIds = connectionId
      ? [connectionId]
      : memberships.map((m) => m.connectionId);

    return this.db.dataEntry.findMany({
      where: {
        connectionId: { in: connectionIds },
        ...(costStructureId ? { costStructureId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        rawContent: true,
        sourceType: true,
        status: true,
        reviewNote: true,
        costistaNote: true,
        createdAt: true,
        reviewedAt: true,
        fileName: true,
        fileMimeType: true,
        fileUrl: true,
        connectionId: true,
        connection: { select: { company: { select: { name: true } } } },
      },
    });
  }

  // ── Operador: Métricas (Fase 4) ───────────────────────────────────────────

  async getStructureMetrics(operatorId: string, connectionId: string, structureId: string) {
    const membership = await this.db.operatorMembership.findFirst({
      where: { operatorId, connectionId, isActive: true },
      include: { connection: { select: { companyId: true } } },
    });
    if (!membership) throw new ForbiddenError('No tenés acceso a esta empresa.');

    // Verificar que la estructura pertenece a esa empresa
    const structure = await this.db.costStructure.findFirst({
      where: { id: structureId, companyId: membership.connection.companyId, deletedAt: null },
      select: { id: true, productName: true }
    });
    if (!structure) throw new NotFoundError('Estructura no encontrada o no pertenece a la empresa.');

    // Traer el último CostCalculation para esta estructura
    const latestCalc = await this.db.costCalculation.findFirst({
      where: { costStructureId: structureId },
      orderBy: { calculatedAt: 'desc' }
    });

    if (!latestCalc) {
      return null;
    }

    return {
      productName: structure.productName,
      productionCost: Number(latestCalc.productionCost),
      grossMargin: Number(latestCalc.grossMargin),
      grossMarginPct: Number(latestCalc.grossMarginPct),
      rawMaterialConsumed: Number(latestCalc.rawMaterialConsumed),
      directLaborTotal: Number(latestCalc.directLaborTotal),
      indirectCostsApplied: Number(latestCalc.indirectCostsApplied),
      calculatedAt: latestCalc.calculatedAt
    };
  }
}
