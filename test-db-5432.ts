import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@localhost:5432/costear' } }
});

async function run() {
  try {
    const count = await prisma.vaultChunk.count();
    console.log('Chunks in 5432:', count);
    const users = await prisma.user.count();
    console.log('Users in 5432:', users);
  } catch (e: any) {
    console.error('Error connecting to 5432:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}
run();
