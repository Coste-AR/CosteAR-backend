/**
 * Servicio de chat del costista.
 *
 * Flujo:
 *  1. interpret()  → IA analiza el mensaje y propone una acción
 *  2. confirm()    → Si el costista acepta, se aplica la acción en la DB
 *
 * NO se escribe nada en la DB hasta que el costista confirma explícitamente.
 */

import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  GroqCostitaChat,
  type CostitaChatResponse,
  type ProposedEntry,
  type ProposedAlert,
} from '../../infrastructure/ai/groq-costista-chat.js';

const groqChat = new GroqCostitaChat();

export interface InterpretInput {
  message: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface ConfirmInput {
  actionType: 'CREATE_ENTRY' | 'CREATE_ALERT';
  proposedEntry?: ProposedEntry;
  proposedAlert?: ProposedAlert;
}

export class CostitaChatService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** Obtiene el contexto de la cartera del costista para enviar a la IA. */
  private async buildPortfolioContext(userId: string) {
    const [companies, pendingCount, activeAlerts, macro] = await Promise.all([
      // Company.userId es el dueño (costista)
      this.db.company.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          industry: true,
          _count: { select: { costStructures: true } },
        },
        orderBy: { name: 'asc' },
      }),
      // DataEntry.costistId es el campo denormalizado
      this.db.dataEntry.count({
        where: { status: 'PENDING', costistId: userId },
      }),
      // Alert.userId es el costista propietario
      this.db.alert.count({
        where: { userId, isRead: false },
      }),
      this.db.macroSnapshot.findMany({
        orderBy: { effectiveDate: 'desc' },
        distinct: ['indicatorCode'],
        take: 5,
        select: { indicatorCode: true, value: true },
      }),
    ]);

    const macroMap = Object.fromEntries(
      macro.map((m) => [m.indicatorCode, Number(m.value)]),
    );

    return {
      companies: companies.map((c) => ({
        id: c.id,
        name: c.name,
        industry: c.industry,
        structureCount: c._count.costStructures,
      })),
      pendingCount,
      activeAlerts,
      macroContext: {
        usdOficial: macroMap['USD_OFICIAL'] as number | undefined,
        ipcMensual: macroMap['IPC_NACIONAL'] as number | undefined,
      },
    };
  }

  /**
   * Interpreta el mensaje del costista y devuelve la respuesta de la IA
   * + una acción propuesta (si corresponde). No modifica nada en la DB.
   */
  async interpret(
    userId: string,
    input: InterpretInput,
  ): Promise<CostitaChatResponse> {
    const portfolio = await this.buildPortfolioContext(userId);

    const fallback: CostitaChatResponse = {
      reply: 'Por el momento no puedo interpretar eso. Probá con otra consulta.',
      actionType: 'INFO_ONLY',
      confidence: 0,
    };

    if (!groqChat.isConfigured) return fallback;

    const result = await groqChat.interpret(
      input.message,
      portfolio,
      input.conversationHistory ?? [],
    );

    return result ?? fallback;
  }

  /**
   * Aplica la acción confirmada por el costista.
   * Solo acepta CREATE_ENTRY y CREATE_ALERT — INFO_ONLY no llega aquí.
   */
  async confirm(userId: string, input: ConfirmInput): Promise<{ success: true; id: string }> {
    if (input.actionType === 'CREATE_ENTRY') {
      const entry = input.proposedEntry;
      if (!entry) throw new Error('proposedEntry es requerido para CREATE_ENTRY');

      // Validar que la empresa le pertenece al costista (Company.userId)
      if (entry.companyId) {
        const company = await this.db.company.findFirst({
          where: { id: entry.companyId, userId },
          select: { id: true },
        });
        if (!company) throw new Error('Empresa no encontrada en tu cartera');
      }

      // Buscar la conexión existente entre el costista y la empresa.
      // EmpresaConnection.costistId es quien la creó.
      let connection = await this.db.empresaConnection.findFirst({
        where: {
          companyId: entry.companyId || undefined,
          costistId: userId,
        },
      });

      if (!connection && entry.companyId) {
        connection = await this.db.empresaConnection.create({
          data: {
            companyId: entry.companyId,
            costistId: userId,
            // apiKey generado automáticamente por el @default(uuid()) de Prisma
          },
        });
      }

      if (!connection) throw new Error('No se pudo crear la conexión manual');

      const created = await this.db.dataEntry.create({
        data: {
          connectionId: connection.id,
          costistId: userId,    // campo denormalizado requerido
          rawContent: entry.rawContent,
          sourceType: 'TEXT',
          status: 'APPROVED',  // entradas manuales del costista se aprueban directo
          reviewedAt: new Date(),
          reviewedBy: userId,
        },
        select: { id: true },
      });

      return { success: true, id: created.id };
    }

    if (input.actionType === 'CREATE_ALERT') {
      const alert = input.proposedAlert;
      if (!alert) throw new Error('proposedAlert es requerido para CREATE_ALERT');

      // Validar empresa si se especificó
      if (alert.companyId) {
        const company = await this.db.company.findFirst({
          where: { id: alert.companyId, userId },
          select: { id: true },
        });
        if (!company) throw new Error('Empresa no encontrada en tu cartera');
      }

      // Mapear severity de la IA → AlertType del schema
      const typeMap: Record<string, 'MARGIN_BELOW_THRESHOLD' | 'MACRO_CHANGE' | 'COST_SPIKE'> = {
        HIGH: 'COST_SPIKE',
        MEDIUM: 'MACRO_CHANGE',
        LOW: 'MARGIN_BELOW_THRESHOLD',
      };
      const alertType = typeMap[alert.severity] ?? 'COST_SPIKE';

      const created = await this.db.alert.create({
        data: {
          userId,
          companyId: alert.companyId || null,
          type: alertType,
          message: alert.message,
        },
        select: { id: true },
      });

      return { success: true, id: created.id };
    }

    throw new Error(`actionType inválido: ${input.actionType}`);
  }
}
