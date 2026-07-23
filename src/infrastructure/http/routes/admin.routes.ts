import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../plugins/authenticate.js';
import { prisma } from '../../database/prisma.js';
import { z } from 'zod';
import { hashPassword } from '../../crypto/password.js';
import { nightlyLearningQueue } from '../../workers/queues.js';

const createAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  role: z.enum(['ADMIN', 'COSTISTA', 'EMPRESA_OPERATOR']).default('ADMIN')
});

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/stats
  app.get('/admin/stats', { preHandler: [authenticate, requireRole('ADMIN')] }, async (_request, reply) => {
    
    // SaaS Metrics
    const totalUsers = await prisma.user.count();
    
    // Asumimos que active usuarios son los logueados hoy (simplificado por updatedAt > hoy a las 00:00)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeUsers = await prisma.user.count({
      where: { updatedAt: { gte: today } }
    });
    
    const totalCompanies = await prisma.company.count();

    // Vault Metrics
    const totalChunks = await prisma.vaultChunk.count();
    const totalSignals = await prisma.dailySignal.count();
    const pendingSignals = await prisma.dailySignal.count({ where: { status: 'PENDING' } });
    
    // Rough precision (1 - (RAG_MISS / TOTAL_QUERIES)) -- Since we only store RAG_MISS right now,
    // we just return count of RAG_MISS vs processed. We could store all queries, but this is a proxy.
    const misses = await prisma.dailySignal.count({ where: { type: 'RAG_MISS' } });
    const corrections = await prisma.dailySignal.count({ where: { type: 'USER_CORRECTION' } });

    const sourceGroups = await prisma.dailySignal.groupBy({
      by: ['source'],
      _count: { _all: true },
    });
    
    const signalsBySource = {
      PIPELINE_NOCTURNO: 0,
      COSTISTA_CHAT: 0,
      VALIDACIONES_CORRECCION: 0,
      ...Object.fromEntries(sourceGroups.map(g => [g.source, g._count._all]))
    };

    return reply.status(200).send({
      data: {
        saas: {
          totalUsers,
          activeUsersToday: activeUsers,
          totalCompanies,
        },
        vault: {
          totalChunks,
          totalSignals,
          pendingSignals,
          ragMisses: misses,
          userCorrections: corrections,
          signalsBySource
        }
      }
    });
  });

  // GET /admin/users
  app.get('/admin/users', { preHandler: [authenticate, requireRole('ADMIN')] }, async (_request, reply) => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    return reply.status(200).send({ data: users });
  });

  // POST /admin/users
  app.post('/admin/users', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const { email, password, name, role } = createAdminSchema.parse(request.body);
    
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(400).send({ error: 'El email ya está en uso' });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true
      }
    });

    return reply.status(201).send({ data: user });
  });

  // POST /admin/nightly/run
  app.post('/admin/nightly/run', { preHandler: [authenticate, requireRole('ADMIN')] }, async (_request, reply) => {
    // Añadimos el job con una prioridad o identificador para ejecución inmediata
    await nightlyLearningQueue.add('manual-nightly-pipeline', {}, {
      jobId: `manual-${Date.now()}`
    });
    return reply.status(200).send({ data: { success: true, message: 'Pipeline encolado' } });
  });
}
