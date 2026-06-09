import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EmpresaPortalService } from '../../../application/empresa/empresa-portal-service.js';
import { authenticate } from '../plugins/authenticate.js';

const generateAccessSchema = z.object({
  operatorName: z.string().min(2, 'Nombre demasiado corto').max(120).trim(),
  operatorEmail: z.string().email('Email inválido').toLowerCase().trim(),
});

const submitDocSchema = z.object({
  rawContent: z.string().min(1).max(10_000),
  sourceType: z.enum(['TEXT', 'PDF', 'IMAGE']).default('TEXT'),
  fileName: z.string().max(255).optional(),
});

export async function registerEmpresaPortalRoutes(app: FastifyInstance): Promise<void> {
  const svc = new EmpresaPortalService();

  // ----- Endpoints para el COSTISTA -----

  // Generar acceso para un operador de empresa
  app.post(
    '/empresa-portal/:companyId/operators',
    { preHandler: authenticate },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const { operatorName, operatorEmail } = generateAccessSchema.parse(request.body);
      const result = await svc.generateOperatorAccess(companyId, request.authUser!.id, operatorName, operatorEmail);
      return reply.status(201).send({ data: result });
    },
  );

  // Listar operadores de una empresa
  app.get(
    '/empresa-portal/:companyId/operators',
    { preHandler: authenticate },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const operators = await svc.listOperators(companyId, request.authUser!.id);
      return reply.send({ data: operators });
    },
  );

  // Revocar acceso de un operador
  app.delete(
    '/empresa-portal/operators/:operatorId',
    { preHandler: authenticate },
    async (request, reply) => {
      const { operatorId } = request.params as { operatorId: string };
      await svc.revokeOperator(operatorId, request.authUser!.id);
      return reply.send({ data: { success: true } });
    },
  );

  // ----- Endpoints para el OPERADOR DE EMPRESA -----

  // Subir documento (requiere JWT de EMPRESA_OPERATOR)
  app.post(
    '/empresa-portal/submit',
    { preHandler: authenticate },
    async (request, reply) => {
      const input = submitDocSchema.parse(request.body);
      const entry = await svc.submitDocument(request.authUser!.id, input);
      return reply.status(201).send({
        data: { id: entry.id, status: entry.status },
      });
    },
  );

  // Ver mis envíos anteriores
  app.get(
    '/empresa-portal/my-submissions',
    { preHandler: authenticate },
    async (request, reply) => {
      const items = await svc.listMySubmissions(request.authUser!.id);
      return reply.send({ data: items });
    },
  );
}
