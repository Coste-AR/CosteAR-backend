import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.vaultChunk.count();
  console.log('Total chunks in DB:', count);
}
main().catch(console.error).finally(() => prisma.$disconnect());
