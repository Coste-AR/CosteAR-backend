import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../database/prisma.js';
import { authenticate, auditContext } from '../plugins/authenticate.js';
import { hashPassword, verifyPassword } from '../../crypto/password.js';
import { changePasswordSchema } from '../../../shared/schemas/auth.schema.js';
import { recordAudit } from '../../../application/audit/audit-logger.js';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../../domain/errors/domain-error.js';
import { uploadToCloudinary } from '../../cloudinary/cloudinary-upload.js';
import { TermsService } from '../../../application/legal/terms-service.js';

const updateProfileSchema = z.object({ name: z.string().min(2).max(120).trim() });

// La imagen llega ya RECORTADA desde el front (base64, sin el prefijo data:).
const avatarSchema = z.object({
  imageData: z.string().min(1).max(8_000_000),
  mimeType: z.string().regex(/^image\/(png|jpe?g|webp)$/, 'Formato de imagen no soportado'),
});

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  const terms = new TermsService();

  app.get('/user/profile', { preHandler: authenticate }, async (request) => {
    const user = await prisma.user.findUnique({ where: { id: request.authUser!.id } });
    if (!user) throw new NotFoundError('Usuario no encontrado');
    // Se recalcula en cada carga de la app (no solo al loguear): una sesión
    // puede durar días, y si en el medio se publica una versión nueva de los
    // Términos, tiene que detectarse acá, no recién en el próximo login.
    const { needs } = await terms.needsAcceptance(user.id, user.role);
    return {
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatarUrl: user.avatarUrl,
        twoFactorEnabled: user.twoFactorEnabled,
        mustChangePassword: user.mustChangePassword,
        needsTermsAcceptance: needs,
      },
    };
  });

  // Subir/actualizar foto de perfil (ya recortada en el cliente) → Cloudinary.
  app.post('/user/avatar', { preHandler: authenticate }, async (request) => {
    const { imageData, mimeType } = avatarSchema.parse(request.body);
    let avatarUrl: string;
    try {
      avatarUrl = await uploadToCloudinary(imageData, mimeType, `avatar-${request.authUser!.id}`, 'costear/avatars');
    } catch {
      throw new ValidationError('No se pudo subir la imagen. Intentá de nuevo en unos segundos.');
    }
    const user = await prisma.user.update({
      where: { id: request.authUser!.id },
      data: { avatarUrl },
    });
    await recordAudit({ ...auditContext(request), userId: user.id, action: 'user.avatar.update' });
    return { data: { avatarUrl: user.avatarUrl } };
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

  app.delete('/user/account', { preHandler: authenticate }, async (request) => {
    const userId = request.authUser!.id;
    
    // Obtener todas las empresas del costista
    const companies = await prisma.company.findMany({
      where: { userId },
      select: { id: true },
    });
    const companyIds = companies.map((c) => c.id);

    await prisma.$transaction([
      // Borrar CAEs procesados de sus empresas
      prisma.processedCAE.deleteMany({
        where: { companyId: { in: companyIds } },
      }),
      // Borrar fingerprints de proveedores
      prisma.supplierFingerprint.deleteMany({
        where: { costistId: userId },
      }),
      // Borrar auditorías del clasificador
      prisma.classificationAudit.deleteMany({
        where: { costistId: userId },
      }),
      // Borrar libro de costos
      prisma.costLedgerEntry.deleteMany({
        where: { costistId: userId },
      }),
      // Borrar alertas del usuario
      prisma.alert.deleteMany({
        where: { userId },
      }),
      // Borrar configuraciones de alertas
      prisma.alertSetting.deleteMany({
        where: { userId },
      }),
      // Borrar el usuario (dispara Cascade en Company, connection, memberships, refreshTokens, etc.)
      prisma.user.delete({
        where: { id: userId },
      }),
    ]);

    await recordAudit({ ...auditContext(request), userId, action: 'user.account.delete' });
    return { data: { success: true } };
  });
}
