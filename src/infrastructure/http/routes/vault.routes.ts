import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fastifyMultipart from '@fastify/multipart';
import { VaultQueryService } from '../../../application/vault-query/vault-query-service.js';
import { authenticate, requireRole } from '../plugins/authenticate.js';
import { prisma } from '../../database/prisma.js';
import { GroqService } from '../../ai/groq-service.js';

const vaultQuerySchema = z.object({
  question: z.string().min(3).max(1000)
});

const feedbackSchema = z.object({
  question: z.string().optional(),
  feedback: z.string().min(3).max(2000)
});

export async function registerVaultRoutes(app: FastifyInstance): Promise<void> {
  const service = new VaultQueryService();
  const groqService = new GroqService();

  // Register multipart specifically for transcription
  await app.register(fastifyMultipart);

  app.post('/vault/query', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const { question } = vaultQuerySchema.parse(request.body);
    const result = await service.query(question);
    return reply.status(200).send({ data: result });
  });

  // --- Session Management ---
  
  app.get('/vault/sessions', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const sessions = await prisma.vaultChatSession.findMany({
      where: { userId: request.authUser!.id },
      orderBy: { createdAt: 'desc' }
    });
    return reply.status(200).send({ data: sessions });
  });

  app.post('/vault/sessions', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const session = await prisma.vaultChatSession.create({
      data: {
        userId: request.authUser!.id,
        title: 'Nueva conversación' // Could be generated later based on first query
      }
    });
    return reply.status(201).send({ data: session });
  });

  app.get('/vault/sessions/:id', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const session = await prisma.vaultChatSession.findUnique({
      where: { id: params.id, userId: request.authUser!.id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } }
      }
    });
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return reply.status(200).send({ data: session });
  });

  app.post('/vault/sessions/:id/query', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const { question } = vaultQuerySchema.parse(request.body);

    const session = await prisma.vaultChatSession.findUnique({
      where: { id: params.id, userId: request.authUser!.id }
    });
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    // 1. Guardar mensaje de usuario
    await prisma.vaultChatMessage.create({
      data: {
        sessionId: session.id,
        role: 'USER',
        content: question,
      }
    });

    // Actualizar el título si es la primera pregunta (opcional)
    if (session.title === 'Nueva conversación') {
      await prisma.vaultChatSession.update({
        where: { id: session.id },
        data: { title: question.slice(0, 40) + (question.length > 40 ? '...' : '') }
      });
    }

    // 2. Ejecutar query contra la bóveda
    const result = await service.query(question);

    // 3. Guardar respuesta del asistente
    const assistantMessage = await prisma.vaultChatMessage.create({
      data: {
        sessionId: session.id,
        role: 'ASSISTANT',
        content: result.answer,
        citations: result.citations,
        confidence: result.confidence
      }
    });

    return reply.status(200).send({ data: { result, message: assistantMessage } });
  });

  // --- Voice Transcription ---
  app.post('/vault/transcribe', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No audio file provided' });
    }

    const buffer = await data.toBuffer();
    // Use Groq whisper via service
    const transcribedText = await groqService.transcribeAudio(buffer, data.mimetype, data.filename);
    
    if (!transcribedText) {
      return reply.status(500).send({ error: 'Failed to transcribe audio' });
    }

    return reply.status(200).send({ data: { text: transcribedText } });
  });

  app.post('/vault/feedback', { preHandler: authenticate }, async (request, reply) => {
    const { question, feedback } = feedbackSchema.parse(request.body);
    await prisma.dailySignal.create({
      data: {
        type: 'USER_CORRECTION',
        content: feedback,
        context: {
          originalQuestion: question,
          userId: request.authUser!.id
        }
      }
    });

    return reply.status(200).send({ data: { success: true } });
  });

  app.post('/vault/index', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const { VaultIndexerService } = await import('../../../application/vault-indexer/vault-indexer-service.js');
    const { execSync } = await import('node:child_process');
    const path = await import('node:path');
    
    const vaultPath = process.env.VAULT_PATH || '../CosteAR-vault';
    const resolvedVaultPath = path.resolve(vaultPath);
    let vaultCommit = 'unknown';
    try {
      vaultCommit = execSync('git rev-parse HEAD', { cwd: resolvedVaultPath, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch (e) {
      console.warn('No se pudo obtener el commit para indexación manual.');
    }
    
    const indexer = new VaultIndexerService();
    const result = await indexer.indexVault(resolvedVaultPath, vaultCommit);
    return reply.status(200).send({ data: result });
  });
}
