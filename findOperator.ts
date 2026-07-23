import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const operator = await prisma.user.findFirst({
    where: { role: 'EMPRESA_OPERATOR' },
    select: { email: true, name: true, role: true }
  });
  console.log("Found operator:", operator);
}

main().catch(console.error).finally(() => prisma.$disconnect());
