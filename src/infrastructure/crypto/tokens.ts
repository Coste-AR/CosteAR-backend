import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import { getEnv } from '../config/env.js';

/**
 * Tokens de autenticación.
 *
 * Access token: JWT firmado con RS256 (clave asimétrica). Vida corta (15 min).
 *   Se verifica con la clave PÚBLICA, lo que permite separar el servicio que
 *   firma del que valida sin compartir la clave privada.
 *
 * Refresh token: token OPACO (no JWT) de 256 bits. No contiene información,
 *   solo sirve para canjear. Se guarda en DB hasheado con SHA-256 (no Argon2:
 *   es de alta entropía, no necesita resistencia a fuerza bruta, y SHA-256
 *   permite lookup por igualdad).
 */

export interface AccessTokenPayload {
  sub: string; // userId
  tenantId: string; // = userId (multi-tenant por usuario)
  role: string;
}

function parsePemKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.startsWith('-----BEGIN')) {
    return trimmed.replace(/\\n/g, '\n');
  }
  return Buffer.from(trimmed, 'base64').toString('utf-8');
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const env = getEnv();
  const privateKey = parsePemKey(env.JWT_PRIVATE_KEY);
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: env.JWT_ACCESS_EXPIRY,
    issuer: 'costear',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const env = getEnv();
  const publicKey = parsePemKey(env.JWT_PUBLIC_KEY);
  const decoded = jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: 'costear',
  });
  if (typeof decoded === 'string') {
    throw new Error('Token inválido');
  }
  return {
    sub: decoded.sub as string,
    tenantId: decoded.tenantId as string,
    role: decoded.role as string,
  };
}

/** Genera un refresh token opaco. Devuelve el valor en claro y su hash. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url'); // 256 bits
  return { token, hash: hashRefreshToken(token) };
}

/** Hash determinístico SHA-256 para almacenar/buscar refresh tokens. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Genera un token de reset de password (opaco, alta entropía). */
export function generateOpaqueToken(): { token: string; hash: string } {
  return generateRefreshToken();
}
