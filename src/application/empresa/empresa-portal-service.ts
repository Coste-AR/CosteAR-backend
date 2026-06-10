import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { hashPassword } from '../../infrastructure/crypto/password.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../../domain/errors/domain-error.js';
import { EmailService } from '../../infrastructure/email/email-service.js';
import { GroqService } from '../../infrastructure/ai/groq-service.js';
import { randomBytes } from 'node:crypto';
import { classifyDocument } from '../../infrastructure/classifier/cascade-classifier.js';
import { extractCuits } from '../../infrastructure/classifier/utils/cuit-validator.js';
import { extractCAE } from '../../infrastructure/classifier/utils/cae-validator.js';
import { buildEnrichedText } from '../../infrastructure/classifier/utils/text-enricher.js';

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
      if (existingUser.role === 'COSTISTA') {
        throw new ConflictError(
          `El email ${normalizedEmail} pertenece a una cuenta de costista. ` +
          `No puede ser invitado como operador.`,
        );
      }

      // CASO B: ya es EMPRESA_OPERATOR — solo crear invitación + membership
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

      try {
        await this.emailService.sendOperatorInviteCode(
          normalizedEmail,
          existingUser.name,
          company.name,
          inviteCode,
        );
      } catch (err) {
        console.warn('[empresa-portal] Email de código de invitación no enviado:', err);
      }

      return { email: normalizedEmail, inviteCode, isNewUser: false };
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

    try {
      await this.emailService.sendOperatorInvite(
        normalizedEmail,
        operatorName,
        company.name,
        tempPassword,
        inviteCode,
      );
    } catch (err) {
      console.warn('[empresa-portal] Email de invitación no enviado:', err);
    }

    return { email: normalizedEmail, tempPassword, inviteCode, isNewUser: true };
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

    await this.db.operatorMembership.update({
      where: { id: membership.id },
      data: { isActive: false },
    });
  }

  // ── Operador: listar sus empresas ──────────────────────────────────────────

  async listMyCompanies(operatorId: string) {
    return this.db.operatorMembership.findMany({
      where: { operatorId, isActive: true },
      include: {
        connection: {
          include: { company: { select: { id: true, name: true, industry: true } } },
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

    // ── Step 1: Fetch company industry for industry-aware classification ────────
    const company = await this.db.company.findUnique({
      where: { id: companyId },
      select: { industry: true },
    });
    const industry = company?.industry ?? null;

    // ── Step 2: Run Groq document analysis (extraction + quality + OCR) ────────
    const aiAnalysis = await this.groq.analyzeDocument({
      text: input.rawContent,
      fileData: input.fileData,
      fileMimeType: input.fileMimeType,
      fileName: input.fileName,
    });

    // ── Step 3: Build enriched text (solves image classification problem) ──────
    // Para imágenes: rawContent = "[Archivo: img.jpg]" → sin señales.
    // enrichedText combina el OCR de Groq con los datos extraídos para que
    // las capas 1-4 puedan clasificar correctamente.
    const enrichedText = buildEnrichedText(input.rawContent, aiAnalysis);

    // ── Step 4: Extract supplier CUIT — desde enrichedText (incluye OCR) ──────
    const textToClassify = enrichedText || input.rawContent || (input.fileName ?? '');
    const foundCuits = extractCuits(textToClassify);
    const supplierCuit = foundCuits[0] ?? null;

    // ── Step 5: Check for duplicate CAE ───────────────────────────────────────
    const cae = extractCAE(textToClassify);
    if (cae) {
      const existingCAE = await this.db.processedCAE.findUnique({ where: { cae } });
      if (existingCAE) {
        return {
          isDuplicate: true,
          duplicateEntryId: existingCAE.dataEntryId,
          message: 'Este documento ya fue enviado anteriormente.',
        };
      }
    }

    // ── Step 6: Run cascade classifier v2 ─────────────────────────────────────
    const classification = await classifyDocument({
      text: input.rawContent || (input.fileName ?? ''),
      enrichedText,
      industry,
      sourceType: input.sourceType,
      costistId,
      companyId,
      dataEntryId: 'pending',
      supplierCuit,
      groqQuality: aiAnalysis?.quality ?? null,
      extractedData: aiAnalysis?.extractedData as Record<string, unknown> | null ?? null,
    });

    // ── Step 5: Save DataEntry ─────────────────────────────────────────────────
    const aiJson = aiAnalysis ? JSON.stringify(aiAnalysis) : null;

    const entry = await this.db.dataEntry.create({
      data: {
        connectionId: membership.connectionId,
        costistId,
        rawContent: input.rawContent || (input.fileName ? `[Archivo: ${input.fileName}]` : ''),
        sourceType: input.sourceType,
        status: 'PENDING',
        fileName: input.fileName ?? null,
        fileData: input.fileData ?? null,
        fileMimeType: input.fileMimeType ?? null,
        reviewNote: aiJson,
      },
    });

    // ── Step 7: Persist audit + CAE in a transaction ──────────────────────────
    await this.db.$transaction(async (tx) => {
      await tx.classificationAudit.create({
        data: {
          dataEntryId: entry.id,
          companyId,
          costistId,
          qualityGate: classification.qualityGate,
          definitiveSignal: classification.definitiveSignal,
          corroboratingSignals: classification.signals as unknown as Parameters<typeof tx.classificationAudit.create>[0]['data']['corroboratingSignals'],
          numericValidationDelta: 0,
          supplierFingerprintUsed: classification.supplierFingerprintUsed,
          aiUsed: classification.aiUsed,
          confidenceCap: classification.confidenceCap,
          documentType: classification.documentType,
          costSection: classification.costSection,
          confidence: classification.confidence,
          requiresReview: classification.requiresReview,
          intent: classification.intent,
          industryCategory: classification.industryCategory,
          explanation: classification.explanation,
        },
      });

      if (cae) {
        await tx.processedCAE.create({
          data: { cae, dataEntryId: entry.id, companyId },
        });
      }
    });

    return {
      id: entry.id,
      status: entry.status,
      aiResponse: aiJson,
      classification: {
        documentType: classification.documentType,
        costSection: classification.costSection,
        confidence: classification.confidence,
        requiresReview: classification.requiresReview,
        qualityGate: classification.qualityGate,
      },
      isDuplicate: false,
    };
  }

  // ── Operador: historial de envíos ──────────────────────────────────────────

  async listMySubmissions(operatorId: string, connectionId?: string) {
    const memberships = await this.db.operatorMembership.findMany({
      where: { operatorId, isActive: true },
      select: { connectionId: true },
    });
    if (memberships.length === 0) return [];

    const connectionIds = connectionId
      ? [connectionId]
      : memberships.map((m) => m.connectionId);

    return this.db.dataEntry.findMany({
      where: { connectionId: { in: connectionIds } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        rawContent: true,
        sourceType: true,
        status: true,
        reviewNote: true,
        createdAt: true,
        reviewedAt: true,
        fileName: true,
        fileMimeType: true,
        connectionId: true,
        connection: { select: { company: { select: { name: true } } } },
      },
    });
  }
}
