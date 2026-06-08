import type { FastifyInstance, FastifyReply } from 'fastify';
import { AuthService, type TokenPair } from '../../../application/auth/auth-service.js';
import { EmailService } from '../../email/email-service.js';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyTwoFactorSchema,
} from '../../../shared/schemas/auth.schema.js';
import { authenticate, auditContext } from '../plugins/authenticate.js';
import { getEnv } from '../../config/env.js';

const REFRESH_COOKIE = 'costear_rt';

/** Setea el refresh token como cookie httpOnly, secure, SameSite=strict. */
function setRefreshCookie(reply: FastifyReply, tokens: TokenPair): void {
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === 'production',
    sameSite: 'strict',
    path: `/api/${getEnv().API_VERSION}/auth`,
    expires: tokens.refreshExpiresAt,
    signed: true,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: `/api/${getEnv().API_VERSION}/auth` });
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const auth = new AuthService();
  const email = new EmailService();

  // Rate limit estricto para los endpoints sensibles EN PRODUCCIÓN.
  // En desarrollo se relaja para no bloquear las pruebas del equipo.
  const isProd = getEnv().NODE_ENV === 'production';
  const loginLimit = {
    rateLimit: { max: isProd ? 5 : 100, timeWindow: '15 minutes' },
  };
  const registerLimit = {
    rateLimit: { max: isProd ? 3 : 100, timeWindow: '1 hour' },
  };

  app.post('/auth/register', { config: registerLimit }, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const result = await auth.register(input, auditContext(request));
    setRefreshCookie(reply, result.tokens);
    return reply.status(201).send({
      data: { user: result.user, accessToken: result.tokens.accessToken },
    });
  });

  app.post('/auth/login', { config: loginLimit }, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const result = await auth.login(input, auditContext(request));
    setRefreshCookie(reply, result.tokens);
    return reply.send({
      data: { user: result.user, accessToken: result.tokens.accessToken },
    });
  });

  app.post('/auth/refresh', async (request, reply) => {
    const raw = request.cookies[REFRESH_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    if (!unsigned || !unsigned.valid || !unsigned.value) {
      return reply.status(401).send({
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'Sesión inválida' },
      });
    }
    const tokens = await auth.refresh(unsigned.value, auditContext(request));
    setRefreshCookie(reply, tokens);
    return reply.send({ data: { accessToken: tokens.accessToken } });
  });

  app.post('/auth/logout', async (request, reply) => {
    const raw = request.cookies[REFRESH_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    if (unsigned?.valid && unsigned.value) {
      await auth.logout(unsigned.value, auditContext(request));
    }
    clearRefreshCookie(reply);
    return reply.send({ data: { success: true } });
  });

  app.post('/auth/forgot-password', { config: registerLimit }, async (request, reply) => {
    const input = forgotPasswordSchema.parse(request.body);
    const token = await auth.createPasswordReset(input.email);
    if (token) {
      await email.sendPasswordReset(input.email, token);
    }
    // Respuesta idéntica exista o no el email (anti-enumeración).
    return reply.send({
      data: { message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña' },
    });
  });

  app.post('/auth/reset-password', async (request, reply) => {
    const input = resetPasswordSchema.parse(request.body);
    await auth.resetPassword(input, auditContext(request));
    return reply.send({ data: { success: true } });
  });

  // --- 2FA (requiere estar autenticado) ---

  app.post('/auth/2fa/setup', { preHandler: authenticate }, async (request, reply) => {
    const { qrDataUrl, secret } = await auth.beginTwoFactorSetup(request.authUser!.id);
    return reply.send({ data: { qrDataUrl, secret } });
  });

  app.post('/auth/2fa/confirm', { preHandler: authenticate }, async (request, reply) => {
    const { code } = verifyTwoFactorSchema.parse(request.body);
    const backupCodes = await auth.confirmTwoFactor(
      request.authUser!.id,
      code,
      auditContext(request),
    );
    return reply.send({ data: { backupCodes } });
  });

  app.post('/auth/2fa/disable', { preHandler: authenticate }, async (request, reply) => {
    await auth.disableTwoFactor(request.authUser!.id, auditContext(request));
    return reply.send({ data: { success: true } });
  });
}
