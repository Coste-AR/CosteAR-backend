import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { hashPassword } from '../../infrastructure/crypto/password.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../../domain/errors/domain-error.js';
import { randomBytes } from 'node:crypto';

/**
 * Gestión de operadores de empresa (usuarios EMPRESA_OPERATOR).
 *
 * Flujo:
 *  1. El costista llama a generateOperatorAccess(companyId, costistId).
 *     Se crea un User con rol EMPRESA_OPERATOR vinculado a la EmpresaConnection.
 *     Se devuelven las credenciales temporales al costista para que las comparta.
 *  2. El operador inicia sesión con CUIT temporal + contraseña temporal.
 *     El router del front detecta rol EMPRESA_OPERATOR y muestra solo el portal.
 *  3. El operador sube documentos (texto o nombre de archivo).
 *     Se crean DataEntry con status PENDING para que el costista valide.
 *  4. El costista puede ver sus operadores y revocar accesos.
 */
export class EmpresaPortalService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * El costista genera un operador para una empresa.
   * Crea la EmpresaConnection si no existe todavía.
   * Devuelve las credenciales en claro una única vez.
   */
  async generateOperatorAccess(
    companyId: string,
    costistId: string,
    operatorName: string,
  ): Promise<{ cuit: string; tempPassword: string; operatorId: string }> {
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

    // Generar credenciales temporales
    // CUIT sintético: prefijo 88 (no válido para personas reales, así se diferencia)
    // + 8 dígitos random + dígito verificador 0
    const randomPart = randomBytes(4).toString('hex').slice(0, 8); // 8 hex chars → 8 dígitos
    const cuitBase = `88${randomPart}`;
    // Calcular dígito verificador real
    const cuit = buildSyntheticCuit(cuitBase);

    const tempPassword = randomBytes(6).toString('hex'); // 12 chars legibles
    const passwordHash = await hashPassword(tempPassword);

    const operator = await this.db.user.create({
      data: {
        name: operatorName,
        email: `operador-${connection.id}-${Date.now()}@costear.internal`,
        cuit,
        passwordHash,
        role: 'EMPRESA_OPERATOR',
        operatorConnectionId: connection.id,
        // Onboarding no aplica para operadores
        onboardedAt: new Date(),
      },
    });

    return { cuit, tempPassword, operatorId: operator.id };
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
        cuit: true,
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
        rawContent: input.fileName
          ? `[${input.fileName}] ${input.rawContent}`
          : input.rawContent,
        sourceType: input.sourceType,
        status: 'PENDING',
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
      },
    });
  }
}

/**
 * Genera un CUIT sintético (prefijo 88) con dígito verificador válido.
 * Se usa solo para identificar operadores de empresa en el sistema.
 */
function buildSyntheticCuit(base: string): string {
  // base = "88XXXXXXXX" (10 dígitos)
  const digits = base.padEnd(10, '0').slice(0, 10).split('').map(Number);
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * (digits[i] ?? 0), 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  // Formato: XX-XXXXXXXX-X
  return `${base.slice(0, 2)}-${base.slice(2, 10)}-${check}`;
}
