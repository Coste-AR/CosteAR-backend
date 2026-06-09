import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { hashPassword } from '../../infrastructure/crypto/password.js';
import { NotFoundError, ForbiddenError } from '../../domain/errors/domain-error.js';
import { EmailService } from '../../infrastructure/email/email-service.js';
import { randomBytes } from 'node:crypto';

/**
 * Gestión de operadores de empresa (usuarios EMPRESA_OPERATOR).
 *
 * Flujo revisado:
 *  1. El costista llama a generateOperatorAccess(companyId, costistId, name, email).
 *     Se crea un User con rol EMPRESA_OPERATOR vinculado a la EmpresaConnection.
 *     Se envía un email al operador con sus credenciales temporales.
 *     mustChangePassword = true → el operador debe cambiar su contraseña al entrar.
 *  2. El operador inicia sesión con su EMAIL + contraseña temporal.
 *     El router del front detecta rol EMPRESA_OPERATOR y muestra solo el portal.
 *     Si mustChangePassword está activo, redirige a cambiar contraseña.
 *  3. El operador sube documentos (texto o nombre de archivo).
 *     Se crean DataEntry con status PENDING para que el costista valide.
 *  4. El costista puede ver sus operadores y revocar accesos.
 */
export class EmpresaPortalService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly emailService: EmailService = new EmailService(),
  ) {}

  /**
   * El costista genera un operador para una empresa.
   * El operador recibe sus credenciales por email.
   * Devuelve las credenciales en claro para que el costista también las vea una única vez.
   */
  async generateOperatorAccess(
    companyId: string,
    costistId: string,
    operatorName: string,
    operatorEmail: string,
  ): Promise<{ email: string; tempPassword: string; operatorId: string }> {
    // Verificar que la empresa pertenece al costista
    const company = await this.db.company.findFirst({
      where: { id: companyId, userId: costistId },
    });
    if (!company) throw new NotFoundError('Empresa no encontrada');

    // Obtener o crear la conexión
    let connection = await this.db.empresaConnection.findUnique({
      where: { companyId_costistId: { companyId, costistId } },
    });
    if (!connection) {
      connection = await this.db.empresaConnection.create({
        data: { companyId, costistId },
      });
    }

    const tempPassword = randomBytes(6).toString('hex'); // 12 chars alfanuméricos
    const passwordHash = await hashPassword(tempPassword);

    const operator = await this.db.user.create({
      data: {
        name: operatorName,
        email: operatorEmail.toLowerCase().trim(),
        passwordHash,
        role: 'EMPRESA_OPERATOR',
        mustChangePassword: true,
        operatorConnectionId: connection.id,
        onboardedAt: new Date(),
      },
    });

    // Enviar credenciales por email (no fatal: si falla el email el acceso igual se crea)
    try {
      await this.emailService.sendOperatorInvite(
        operatorEmail,
        operatorName,
        company.name,
        tempPassword,
      );
    } catch (err) {
      console.warn('[empresa-portal] Email de invitación no pudo enviarse:', err);
    }

    return { email: operatorEmail, tempPassword, operatorId: operator.id };
  }

  /**
   * Lista los operadores de una empresa del costista.
   */
  async listOperators(companyId: string, costistId: string) {
    const connection = await this.db.empresaConnection.findUnique({
      where: { companyId_costistId: { companyId, costistId } },
    });
    if (!connection) return [];

    return this.db.user.findMany({
      where: { operatorConnectionId: connection.id, role: 'EMPRESA_OPERATOR' },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * El costista revoca el acceso de un operador.
   */
  async revokeOperator(operatorId: string, costistId: string) {
    const operator = await this.db.user.findUnique({
      where: { id: operatorId },
      include: { operatorConnection: true },
    });
    if (!operator || operator.role !== 'EMPRESA_OPERATOR') {
      throw new NotFoundError('Operador no encontrado');
    }
    if (operator.operatorConnection?.costistId !== costistId) {
      throw new ForbiddenError('No tenés permiso para revocar este acceso');
    }
    await this.db.user.update({
      where: { id: operatorId },
      data: { isActive: false },
    });
  }

  /**
   * El operador sube un documento (texto) al portal.
   * Solo puede subir datos de su propia empresa.
   */
  async submitDocument(
    operatorId: string,
    input: {
      rawContent: string;
      sourceType: 'TEXT' | 'PDF' | 'IMAGE';
      fileName?: string;
      fileData?: string;
      fileMimeType?: string;
    },
  ) {
    const operator = await this.db.user.findUnique({
      where: { id: operatorId },
      include: { operatorConnection: true },
    });
    if (!operator || operator.role !== 'EMPRESA_OPERATOR') {
      throw new ForbiddenError('Acceso no autorizado');
    }
    if (!operator.isActive) {
      throw new ForbiddenError('Tu acceso fue revocado. Contactá al costista.');
    }
    if (!operator.operatorConnection) {
      throw new NotFoundError('Conexión no encontrada');
    }

    return this.db.dataEntry.create({
      data: {
        connectionId: operator.operatorConnection.id,
        costistId: operator.operatorConnection.costistId,
        rawContent: input.rawContent || (input.fileName ? `[Archivo: ${input.fileName}]` : ''),
        sourceType: input.sourceType,
        status: 'PENDING',
        fileName: input.fileName ?? null,
        fileData: input.fileData ?? null,
        fileMimeType: input.fileMimeType ?? null,
      },
    });
  }

  /**
   * El operador ve las entradas que ya subió (su historial propio).
   */
  async listMySubmissions(operatorId: string) {
    const operator = await this.db.user.findUnique({ where: { id: operatorId } });
    if (!operator || !operator.operatorConnectionId) return [];

    return this.db.dataEntry.findMany({
      where: { connectionId: operator.operatorConnectionId },
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
      },
    });
  }
}
