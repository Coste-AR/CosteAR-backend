import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../../config/env.js';
import { verifyToken } from '../../crypto/password.js';
import { UnauthorizedError } from '../../../domain/errors/domain-error.js';

const accessSchema = z.object({ password: z.string().min(1).max(200) });

/**
 * Gate de acceso previo al login (producto en construcción). Verifica la
 * contraseña del equipo contra un HASH Argon2id (ACCESS_GATE_HASH) — el texto
 * plano nunca se guarda ni viaja al frontend. Argon2 es intencionalmente lento,
 * lo que frena por sí solo los intentos de fuerza bruta.
 */
export async function registerAccessGateRoutes(app: FastifyInstance): Promise<void> {
  app.post('/access-gate', async (request) => {
    const { password } = accessSchema.parse(request.body);
    const ok = await verifyToken(getEnv().ACCESS_GATE_HASH, password);
    if (!ok) throw new UnauthorizedError('Contraseña incorrecta');
    return { data: { ok: true } };
  });
}
