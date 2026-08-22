import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { NotFoundError, ConflictError } from '../../domain/errors/domain-error.js';
import { ingestDataEntry } from '../ingest/ingest-data-entry.js';

export class EmpresaConnectionService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Crea una conexión entre una empresa del costista y sí mismo.
   * Genera una apiKey única para que la empresa pueda enviar datos.
   */
  async createConnection(companyId: string, costistId: string) {
    const company = await this.db.company.findFirst({
      where: { id: companyId, userId: costistId },
    });
    if (!company) throw new NotFoundError('Empresa no encontrada');

    const existing = await this.db.empresaConnection.findUnique({
      where: { companyId_costistId: { companyId, costistId } },
    });
    if (existing) throw new ConflictError('Ya existe una conexión para esta empresa');

    return this.db.empresaConnection.create({
      data: { companyId, costistId },
      include: { company: { select: { id: true, name: true } } },
    });
  }

  /**
   * Lista todas las conexiones del costista con sus empresas.
   */
  async listConnections(costistId: string) {
    return this.db.empresaConnection.findMany({
      where: { costistId },
      include: {
        company: { select: { id: true, name: true, industry: true, cuit: true } },
        _count: { select: { dataEntries: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Rota la apiKey de una conexión.
   */
  async rotateApiKey(connectionId: string, costistId: string) {
    const conn = await this.db.empresaConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundError('Conexión no encontrada');
    if (conn.costistId !== costistId) throw new NotFoundError('Conexión no encontrada');

    // Generar nuevo UUID como apiKey
    const { randomUUID } = await import('node:crypto');
    return this.db.empresaConnection.update({
      where: { id: connectionId },
      data: { apiKey: randomUUID() },
    });
  }

  /**
   * Elimina una conexión (el costista desvincula la empresa).
   */
  async deleteConnection(connectionId: string, costistId: string) {
    const conn = await this.db.empresaConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundError('Conexión no encontrada');
    if (conn.costistId !== costistId) throw new NotFoundError('Conexión no encontrada');

    await this.db.empresaConnection.delete({ where: { id: connectionId } });
  }

  async setWhatsappNumber(costistId: string, connectionId: string, phoneNumber: string) {
    const conn = await this.db.empresaConnection.findFirst({
      where: { id: connectionId, costistId },
    });
    if (!conn) throw new NotFoundError('Conexión no encontrada');

    return this.db.empresaConnection.update({
      where: { id: connectionId },
      data: { whatsappPhoneNumber: phoneNumber },
    });
  }

  async findByWhatsappNumber(phoneNumber: string) {
    return this.db.empresaConnection.findUnique({
      where: { whatsappPhoneNumber: phoneNumber, isActive: true },
    });
  }

  /**
   * Endpoint público: la empresa sube un dato usando su apiKey.
   * No requiere JWT — usa la apiKey embebida.
   */
  async submitDataViaApiKey(
    apiKey: string,
    payload: { rawContent: string; sourceType: 'TEXT' | 'PDF' | 'IMAGE' | 'WHATSAPP' },
  ) {
    const conn = await this.db.empresaConnection.findUnique({
      where: { apiKey },
    });
    if (!conn || !conn.isActive) throw new NotFoundError('API key inválida');

    return ingestDataEntry(
      {
        connectionId: conn.id,
        costistId: conn.costistId,
        companyId: conn.companyId,
        rawContent: payload.rawContent,
        sourceType: payload.sourceType,
      },
      { db: this.db },
    );
  }
}
