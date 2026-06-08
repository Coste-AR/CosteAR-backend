import argon2 from 'argon2';
import { getEnv } from '../config/env.js';

/**
 * Hashing de contraseñas con Argon2id — ganador del Password Hashing
 * Competition, resistente a ataques GPU/ASIC. Se suma un "pepper" secreto
 * (de entorno) al password antes de hashear: aunque se filtre la base de
 * datos, sin el pepper los hashes son inútiles para un atacante.
 */

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
};

function pepper(password: string): string {
  return password + getEnv().ARGON2_PEPPER;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(pepper(password), ARGON2_OPTIONS);
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, pepper(password));
  } catch {
    // argon2.verify lanza si el hash está corrupto; tratamos como no-match.
    return false;
  }
}

/** Hash genérico Argon2id (sin pepper) para tokens opacos y backup codes. */
export async function hashToken(token: string): Promise<string> {
  return argon2.hash(token, ARGON2_OPTIONS);
}

export async function verifyToken(hash: string, token: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, token);
  } catch {
    return false;
  }
}
