/**
 * reset-password.ts — resetea la contraseña de un usuario.
 *
 * Existe porque el envío de mails está caído (Railway bloquea SMTP saliente,
 * `/auth/email-health` devuelve ETIMEDOUT), así que el flujo de "olvidé mi
 * contraseña" no sirve para recuperar una cuenta.
 *
 * IMPORTANTE — el pepper tiene que ser el del entorno destino:
 *
 *   El hash se calcula como argon2(password + ARGON2_PEPPER). Si generás el
 *   hash con el pepper local y lo guardás en la base de staging, el login va a
 *   seguir fallando con "credenciales incorrectas", porque staging verifica con
 *   SU pepper. Pasá siempre las dos variables juntas, copiadas del servicio de
 *   Railway correspondiente (Variables → ARGON2_PEPPER).
 *
 * Uso:
 *   DATABASE_URL="<url>" ARGON2_PEPPER="<pepper>" \
 *     npx tsx scripts/reset-password.ts <email> <contraseña-nueva>
 */

import { prisma } from '../src/infrastructure/database/prisma.js';
import { hashPassword } from '../src/infrastructure/crypto/password.js';

async function main(): Promise<void> {
  const [email, nueva] = process.argv.slice(2);

  if (!email || !nueva) {
    console.error('Uso: npx tsx scripts/reset-password.ts <email> <contraseña-nueva>');
    process.exit(1);
  }
  if (nueva.length < 8) {
    console.error('La contraseña nueva tiene que tener al menos 8 caracteres.');
    process.exit(1);
  }
  if (!process.env['ARGON2_PEPPER']) {
    console.error('Falta ARGON2_PEPPER. Sin ella se usaría el default del código');
    console.error('y el hash resultante no validaría contra el entorno real.');
    process.exit(1);
  }

  const usuario = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true, name: true, role: true, isLocked: true },
  });

  if (!usuario) {
    console.error(`No existe ningún usuario con el email "${email}" en esta base.`);
    console.error('Ojo: staging y producción son bases distintas.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(nueva);

  await prisma.user.update({
    where: { id: usuario.id },
    data: {
      passwordHash,
      // Si venía bloqueada por intentos fallidos, se destraba de paso.
      isLocked: false,
      lockedUntil: null,
      failedLoginAttempts: 0,
    },
  });

  console.log('');
  console.log('Contraseña actualizada.');
  console.log(`  usuario: ${usuario.name ?? '(sin nombre)'} <${usuario.email}>`);
  console.log(`  rol:     ${usuario.role}`);
  if (usuario.isLocked) console.log('  (la cuenta estaba bloqueada — se destrabó)');
  console.log('');
}

main()
  .catch((err) => {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
