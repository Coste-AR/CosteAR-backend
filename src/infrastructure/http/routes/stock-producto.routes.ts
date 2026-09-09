import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { StockProductoService } from '../../../application/operacion/stock-producto-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { egresoProductoCreateSchema } from '../../../shared/schemas/stock-producto.schema.js';

const companyParams = z.object({ companyId: z.string().uuid() });
const produccionParams = z.object({ produccionId: z.string().uuid() });
const consultaStock = z.object({ al: z.string().date() });
const actor = (request: FastifyRequest) => ({ id: request.authUser!.id, role: request.authUser!.role, jobTitle: request.authUser!.jobTitle, area: 'costista', method: 'manual', device: `${request.headers['user-agent'] ?? 'desconocido'} · ${request.ip}` });

export async function registerStockProductoRoutes(app: FastifyInstance): Promise<void> {
  const service = new StockProductoService();
  app.get('/companies/:companyId/stock-productos', { preHandler: authenticate }, async (request) => {
    const { companyId } = companyParams.parse(request.params);
    const { al } = consultaStock.parse(request.query);
    return { data: await service.stock(request.authUser!.id, companyId, al) };
  });
  app.post('/producciones/:produccionId/egresos', { preHandler: authenticate }, async (request, reply) => {
    const { produccionId } = produccionParams.parse(request.params);
    return reply.code(201).send({ data: await service.egresar(request.authUser!.id, produccionId, egresoProductoCreateSchema.parse(request.body), actor(request)) });
  });
}
