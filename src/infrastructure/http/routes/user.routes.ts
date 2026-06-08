import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../database/prisma.js';
import { authenticate, auditContext } from '../plugins/authenticate.js';
import { hashPassword, verifyPassword } from '../../crypto/password.js';
import { changePasswordSchema } from '../../../shared/schemas/auth.schema.js';
import { recordAudit } from '../../../application/audit/audit-logger.js';
import { NotFoundError, UnauthorizedError } from '../../../domain/errors/domain-error.js';

const updateProfileSchema = z.object({ name: z.string().min(2).max(120).trim() });

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/user/profile', { preHandler: authenticate }, async (request) => {
    const user = await prisma.user.findUnique({ where: { id: request.authUser!.id } });
    if (!user) throw new NotFoundError('Usuario no encontrado');
    return {
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled,
      },
    };
  });

  app.put('/user/profile', { preHandler: authenticate }, async (request) => {
    const { name } = updateProfileSchema.parse(request.body);
    const user = await prisma.user.update({
      where: { id: request.authUser!.id },
      data: { name },
    });
    return { data: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  app.put('/user/password', { preHandler: authenticate }, async (request) => {
    const input = changePasswordSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: request.authUser!.id } });
    if (!user) throw new NotFoundError('Usuario no encontrado');

    const valid = await verifyPassword(user.passwordHash, input.currentPassword);
    if (!valid) throw new UnauthorizedError('La contraseña actual es incorrecta');

    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      // Cierra todas las sesiones tras cambiar el password.
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await recordAudit({ ...auditContext(request), userId: user.id, action: 'user.password.change' });
    return { data: { success: true } };
  });
}
