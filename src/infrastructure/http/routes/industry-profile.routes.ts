import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../plugins/authenticate.js';
import { prisma } from '../../database/prisma.js';
import { industryProfileService } from '../../classifier/industry/industry-profile-service.js';

const categoryParam = z.object({ category: z.string().min(1) });

const updateBody = z.object({
  label: z.string().min(1).optional(),
  mpKeywords: z.array(z.string()).optional(),
  cipKeywords: z.array(z.string()).optional(),
  modKeywords: z.array(z.string()).optional(),
  eventKeywords: z.array(z.string()).optional(),
  lossKeywords: z.array(z.string()).optional(),
  energyIsMP: z.boolean().optional(),
  fuelIsMP: z.boolean().optional(),
  detectPatterns: z.array(z.string()).optional(),
  measurementUnit: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function registerIndustryProfileRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/industry-profiles — lista todos los perfiles (incluye inactivos)
  app.get(
    '/admin/industry-profiles',
    { preHandler: [authenticate, requireRole('ADMIN')] },
    async (_request, reply) => {
      const profiles = await prisma.industryProfile.findMany({
        orderBy: { category: 'asc' },
      });
      return reply.status(200).send({ data: profiles });
    },
  );

  // PUT /admin/industry-profiles/:category — edita keywords/flags e invalida el caché
  app.put(
    '/admin/industry-profiles/:category',
    { preHandler: [authenticate, requireRole('ADMIN')] },
    async (request, reply) => {
      const { category } = categoryParam.parse(request.params);
      const body = updateBody.parse(request.body);

      const existing = await prisma.industryProfile.findUnique({ where: { category } });
      if (!existing) {
        return reply
          .status(404)
          .send({ error: `No existe el perfil de industria "${category}"` });
      }

      const updated = await prisma.industryProfile.update({
        where: { category },
        data: body,
      });

      industryProfileService.invalidateCache();

      return reply.status(200).send({ data: updated });
    },
  );
}
