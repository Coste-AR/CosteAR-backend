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
  role: z.literal('ADMIN').default('ADMIN')
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

    // --- Métricas de la bóveda ---
    const totalChunks = await prisma.vaultChunk.count();
    const totalSignals = await prisma.dailySignal.count();
    const pendingSignals = await prisma.dailySignal.count({ where: { status: 'PENDING' } });
    const userCorrections = await prisma.dailySignal.count({ where: { type: 'USER_CORRECTION' } });

    const sourceGroups = await prisma.dailySignal.groupBy({
      by: ['source'],
      _count: { _all: true },
    });
    const signalsBySource = {
      PIPELINE_NOCTURNO: 0,
      COSTISTA_CHAT: 0,
      VALIDACIONES_CORRECCION: 0,
      ...Object.fromEntries(sourceGroups.map((g) => [g.source, g._count._all])),
    };

    // --- Métricas reales del RAG desde vault_query_log (reemplazan la "precisión proxy") ---
    const now = Date.now();
    const since7d = new Date(now - 7 * 24 * 3600 * 1000);
    const since30d = new Date(now - 30 * 24 * 3600 * 1000);

    const [queries7d, queries30d, confGroups, feedbackGroups, withFeedback, topCited, recentMisses] =
      await Promise.all([
        prisma.vaultQueryLog.count({ where: { createdAt: { gte: since7d } } }),
        prisma.vaultQueryLog.count({ where: { createdAt: { gte: since30d } } }),
        prisma.vaultQueryLog.groupBy({
          by: ['confidence'],
          where: { createdAt: { gte: since30d } },
          _count: { _all: true },
        }),
        prisma.vaultQueryLog.groupBy({
          by: ['feedbackUseful'],
          where: { createdAt: { gte: since30d }, feedbackUseful: { not: null } },
          _count: { _all: true },
        }),
        prisma.vaultQueryLog.count({
          where: { createdAt: { gte: since30d }, feedbackUseful: { not: null } },
        }),
        prisma.$queryRaw<Array<{ sourceFile: string; uses: bigint }>>`
          SELECT elem->>'sourceFile' AS "sourceFile", count(*) AS "uses"
          FROM "vault_query_log", jsonb_array_elements("chunksReturned") elem
          WHERE "createdAt" >= ${since30d}
          GROUP BY 1 ORDER BY 2 DESC LIMIT 10
        `,
        prisma.vaultQueryLog.findMany({
          where: { confidence: 'NONE' },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { question: true, createdAt: true },
        }),
      ]);

    const byConfidence: { HIGH: number; LOW: number; NONE: number } = { HIGH: 0, LOW: 0, NONE: 0 };
    for (const g of confGroups) {
      if (g.confidence === 'HIGH' || g.confidence === 'LOW' || g.confidence === 'NONE') {
        byConfidence[g.confidence] = g._count._all;
      }
    }
    const totalScored = byConfidence.HIGH + byConfidence.LOW + byConfidence.NONE;

    const thumbsUp = feedbackGroups.find((g) => g.feedbackUseful === true)?._count._all ?? 0;
    const thumbsDown = feedbackGroups.find((g) => g.feedbackUseful === false)?._count._all ?? 0;

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
          userCorrections,
          signalsBySource,
          // null cuando todavía no hay tráfico: no mostrar ceros como si fueran datos.
          queryLog:
            queries30d === 0
              ? null
              : {
                  queries7d,
                  queries30d,
                  byConfidence,
                  refusalRate: totalScored > 0 ? byConfidence.NONE / totalScored : 0,
                  feedback: {
                    up: thumbsUp,
                    down: thumbsDown,
                    withFeedbackPct: queries30d > 0 ? withFeedback / queries30d : 0,
                  },
                  topCitedFiles: topCited.map((r) => ({
                    sourceFile: r.sourceFile,
                    uses: Number(r.uses),
                  })),
                  recentMisses: recentMisses.map((m) => ({
                    question: m.question,
                    at: m.createdAt,
                  })),
                },
        },
      },
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
