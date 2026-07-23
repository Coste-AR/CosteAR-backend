import { prisma } from '../../infrastructure/database/prisma.js';
import { UnprocessableEntityError, NotFoundError } from '../../domain/errors/domain-error.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getEnv } from '../../infrastructure/config/env.js';

const execFileAsync = promisify(execFile);

export class ProposalService {
  async listPending() {
    return prisma.vaultEditProposal.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' }
    });
  }

  async approveProposal(userId: string, proposalId: string) {
    const proposal = await prisma.vaultEditProposal.findUnique({ where: { id: proposalId } });
    if (!proposal) throw new NotFoundError('Propuesta no encontrada');
    if (proposal.status !== 'PENDING') throw new UnprocessableEntityError('La propuesta ya fue procesada');

    // 1. Escribir al archivo en la bóveda
    // Usamos una variable de entorno para saber dónde está el vault (por defecto ../CosteAR-vault)
    const vaultPath = process.env.VAULT_PATH || '../CosteAR-vault';
    const resolvedVaultPath = path.resolve(vaultPath);
    const fullPath = path.resolve(vaultPath, proposal.sourceFile);

    // sourceFile lo genera la IA (nightly-learning-service.ts) a partir de señales de
    // usuarios — nunca confiar en que sea una ruta segura. Sin esta validación, una
    // señal maliciosa/prompt-injected podría hacer que el LLM proponga un sourceFile
    // tipo "../../../.env" y approveProposal escribiría FUERA de la bóveda.
    if (fullPath !== resolvedVaultPath && !fullPath.startsWith(resolvedVaultPath + path.sep)) {
      throw new UnprocessableEntityError(
        `sourceFile inválido: "${proposal.sourceFile}" resuelve fuera de la bóveda.`,
      );
    }

    try {
      // Intentamos agregar el texto al final del archivo. Si no existe, lo crea.
      await fs.appendFile(fullPath, `\n\n${proposal.proposedText}`, 'utf-8');
    } catch (err) {
      console.error('Error escribiendo en el vault:', err);
      throw new UnprocessableEntityError('No se pudo escribir en el archivo de la bóveda.');
    }

    // 2. Hacer commit en el repositorio de la bóveda
    // execFile (no exec) con args en array: title/sourceFile los generó la IA y NUNCA
    // deben interpolarse en un string que pase por un shell (riesgo de command injection).
    try {
      await execFileAsync('git', ['add', proposal.sourceFile], { cwd: vaultPath });
      await execFileAsync(
        'git',
        ['commit', '-m', `Auto-mejora: ${proposal.title} (Aprobado por Validador)`],
        { cwd: vaultPath },
      );
    } catch (err) {
      console.warn('No se pudo hacer commit automático en la bóveda (¿no es repo git?).', err);
      // No lanzamos error para no bloquear el flujo si solo está probando localmente
    }

    // 3. Marcar como procesado
    const updated = await prisma.vaultEditProposal.update({
      where: { id: proposalId },
      data: { 
        status: 'PROCESSED',
        reviewedBy: userId,
        reviewedAt: new Date()
      }
    });

    return updated;
  }

  async updateProposal(
    proposalId: string,
    data: { title?: string; sourceFile?: string; proposedText?: string; justification?: string },
  ) {
    const proposal = await prisma.vaultEditProposal.findUnique({ where: { id: proposalId } });
    if (!proposal) throw new NotFoundError('Propuesta no encontrada');
    if (proposal.status !== 'PENDING') throw new UnprocessableEntityError('La propuesta ya fue procesada');

    return prisma.vaultEditProposal.update({
      where: { id: proposalId },
      data: {
        ...data,
        // Un admin editó el contenido a mano: ya no es un borrador de IA sin verificar.
        requiresVerification: false,
      },
    });
  }

  async rejectProposal(userId: string, proposalId: string) {
    const proposal = await prisma.vaultEditProposal.findUnique({ where: { id: proposalId } });
    if (!proposal) throw new NotFoundError('Propuesta no encontrada');
    
    return prisma.vaultEditProposal.update({
      where: { id: proposalId },
      data: { 
        status: 'REJECTED',
        reviewedBy: userId,
        reviewedAt: new Date()
      }
    });
  }
}
