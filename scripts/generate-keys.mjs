// Genera el par de claves RSA para firmar/verificar JWT (RS256) y secretos
// aleatorios para cookies, TOTP y pepper. Imprime un bloque .env listo para pegar.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const escape = (pem) => pem.trim().replace(/\n/g, '\\n');
const rand = (bytes) => randomBytes(bytes).toString('hex');

console.log(`JWT_PRIVATE_KEY="${escape(privateKey)}"`);
console.log(`JWT_PUBLIC_KEY="${escape(publicKey)}"`);
console.log(`COOKIE_SECRET=${rand(32)}`);
console.log(`TOTP_ENCRYPTION_KEY=${rand(16)}`); // 16 bytes hex = 32 chars
console.log(`ARGON2_PEPPER=${rand(32)}`);
