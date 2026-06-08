import { authenticator } from 'otplib';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import qrcode from 'qrcode';
import { getEnv } from '../config/env.js';

/**
 * 2FA basado en TOTP (RFC 6238), compatible con Google Authenticator, Authy, etc.
 *
 * El secreto TOTP se cifra con AES-256-GCM antes de guardarse en la base de
 * datos: si la DB se filtra, los secretos de segundo factor no quedan expuestos.
 */

const ALGORITHM = 'aes-256-gcm';

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function verifyTotp(secret: string, token: string): boolean {
  return authenticator.verify({ token, secret });
}

/** URI otpauth:// para construir el QR que el usuario escanea. */
export function buildTotpUri(secret: string, accountEmail: string): string {
  return authenticator.keyuri(accountEmail, 'CosteAR', secret);
}

export async function buildTotpQrDataUrl(
  secret: string,
  accountEmail: string,
): Promise<string> {
  return qrcode.toDataURL(buildTotpUri(secret, accountEmail));
}

// --- Cifrado del secreto en reposo (AES-256-GCM) ---

function key(): Buffer {
  // TOTP_ENCRYPTION_KEY tiene exactamente 32 caracteres (validado en env).
  return Buffer.from(getEnv().TOTP_ENCRYPTION_KEY, 'utf8');
}

/** Cifra el secreto. Formato de salida: iv:authTag:ciphertext (hex). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Secreto TOTP cifrado con formato inválido');
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/** Genera N backup codes legibles (para guardar hasheados). */
export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () =>
    randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-'),
  );
}
