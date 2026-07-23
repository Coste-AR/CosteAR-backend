import { PrismaClient } from '@prisma/client';
import { hashPassword } from './src/application/auth/crypto.js';

const prisma = new PrismaClient();

async function main() {
  const hash = await hashPassword('operador123');
  const operator = await prisma.user.upsert({
    where: { email: 'operador@costear.com' },
    update: { passwordHash: hash, role: 'EMPRESA_OPERATOR' },
    create: {
      email: 'operador@costear.com',
      name: 'Operador de Prueba',
      passwordHash: hash,
      role: 'EMPRESA_OPERATOR'
    }
  });
  console.log("Created operator:", operator);
}

main().catch(console.error).finally(() => prisma.$disconnect());
