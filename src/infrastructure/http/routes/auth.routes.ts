import type { FastifyInstance, FastifyReply } from 'fastify';
import { AuthService, type TokenPair } from '../../../application/auth/auth-service.js';
import { EmailService } from '../../email/email-service.js';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyTwoFactorSchema,
  passwordSchema,
} from '../../../shared/schemas/auth.schema.js';
import { z } from 'zod';
import { authenticate, auditContext } from '../plugins/authenticate.js';
import { getEnv } from '../../config/env.js';

const REFRESH_COOKIE = 'costear_rt';

/**
 * Setea el refresh token como cookie httpOnly.
 * - Desarrollo: SameSite=Strict (frontend y backend en localhost).
 * - Producción: SameSite=None + Secure, porque el frontend (otro dominio)
 *   necesita poder enviar la cookie al backend en /auth/refresh. El token es
 *   opaco, httpOnly y rotado, y el CORS está en whitelist: el riesgo CSRF
 *   queda acotado.
 */
function setRefreshCookie(reply: FastifyReply, tokens: TokenPair): void {
  const isProd = getEnv().NODE_ENV === 'production';
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'strict',
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
    rateLimit: { max: isProd ? 20 : 100, timeWindow: '1 hour' },
  };

  // Verifica disponibilidad de CUIT sin revelar más info que la necesaria.
  app.get('/auth/check-cuit', {
    config: { rateLimit: { max: isProd ? 30 : 200, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { cuit } = request.query as { cuit?: string };
    if (!cuit) {
      return reply.status(400).send({ error: { message: 'CUIT requerido' } });
    }
    const clean = cuit.replace(/[-\s]/g, '');
    if (!/^\d{11}$/.test(clean)) {
      return reply.status(400).send({ error: { message: 'CUIT inválido' } });
    }
    const exists = await auth.cuitExists(cuit);
    return reply.send({ data: { available: !exists } });
  });

  // Verifica disponibilidad de email sin revelar más info que la necesaria.
  // Rate limit propio para evitar enumeración masiva.
  app.get('/auth/check-email', {
    config: { rateLimit: { max: isProd ? 30 : 200, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { email: emailParam } = request.query as { email?: string };
    if (!emailParam || !/\S+@\S+\.\S+/.test(emailParam)) {
      return reply.status(400).send({ error: { message: 'Email inválido' } });
    }
    const existing = await auth.emailExists(emailParam.toLowerCase());
    return reply.send({ data: { available: !existing } });
  });

  app.post('/auth/register', { config: registerLimit }, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const result = await auth.register(input, auditContext(request));
    setRefreshCookie(reply, result.tokens);
    return reply.status(201).send({
      data: { user: result.user, accessToken: result.tokens.accessToken, refreshToken: result.tokens.refreshToken },
    });
  });

  app.post('/auth/login', { config: loginLimit }, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const result = await auth.login(input, auditContext(request));
    setRefreshCookie(reply, result.tokens);
    return reply.send({
      data: {
        user: result.user,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,   // para clientes que no pueden usar cookies cross-origin
      },
    });
  });

  app.post('/auth/refresh', async (request, reply) => {
    // Primero intentar desde cookie firmada; si no, desde body (clientes cross-origin)
    const raw = request.cookies[REFRESH_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    const tokenFromCookie = unsigned?.valid ? unsigned.value : null;
    const tokenFromBody = (request.body as Record<string, unknown>)?.refreshToken as string | undefined;
    const refreshTokenValue = tokenFromCookie ?? tokenFromBody ?? null;

    if (!refreshTokenValue) {
      return reply.status(401).send({
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'Sesión inválida' },
      });
    }
    const tokens = await auth.refresh(refreshTokenValue, auditContext(request));
    setRefreshCookie(reply, tokens);
    return reply.send({
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    const raw = request.cookies[REFRESH_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    const tokenFromCookie = unsigned?.valid ? unsigned.value : null;
    const tokenFromBody = (request.body as Record<string, unknown>)?.refreshToken as string | undefined;
    const refreshTokenValue = tokenFromCookie ?? tokenFromBody ?? null;
    if (refreshTokenValue) {
      await auth.logout(refreshTokenValue, auditContext(request)).catch(() => {});
    }
    clearRefreshCookie(reply);
    return reply.send({ data: { success: true } });
  });

  // Diagnóstico temporal del email. Sin query → verifica config. Con ?to=email
  // → envía un mail de prueba REAL y devuelve el resultado (id o error exacto).
  app.get('/auth/email-health', async (request) => {
    const { to } = (request.query ?? {}) as { to?: string };
    if (to) return { data: await email.sendTest(to) };
    return { data: await email.verifyConnection() };
  });

  app.post('/auth/forgot-password', { config: registerLimit }, async (request, reply) => {
    const input = forgotPasswordSchema.parse(request.body);
    const token = await auth.createPasswordReset(input.email);
    if (token) {
      // Fire-and-forget: NO bloqueamos la respuesta esperando al SMTP. Si el envío
      // es lento o falla, la request igual responde al instante (no deja colgado el
      // botón del front). Los errores quedan logueados.
      void email.sendPasswordReset(input.email, token).catch((err) => {
        request.log.error({ err }, 'Error al enviar el email de reset de contraseña');
      });
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

  // --- Cambio de contraseña en primer login (solo EMPRESA_OPERATOR con mustChangePassword) ---

  app.post('/auth/set-first-password', { preHandler: authenticate }, async (request, reply) => {
    const { newPassword } = z.object({ newPassword: passwordSchema }).parse(request.body);
    await auth.setFirstPassword(request.authUser!.id, newPassword, auditContext(request));
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
