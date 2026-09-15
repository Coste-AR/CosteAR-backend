// Seed de UnidadMedida "cajón" para una empresa de prueba — WORKAROUND DECLARADO.
// No existe endpoint HTTP que cree UnidadMedida (grep exhaustivo: los únicos usos
// en src/application/** son findFirst; el único `.create` de todo el repo vive en
// prisma/seed-tenant-avicola.ts, un script de siembra, no una ruta de producto).
// Company.unidadGestionId SÍ se puede setear por API (PUT /companies/:id), pero
// apunta a una fila que un usuario real nunca puede crear. Se usa acá SOLO para
// destrabar BLOQUE 3/4 de esta auditoría, igual que hizo el seed de dev.
import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

const companyId = process.argv[2];
const userId = process.argv[3];
if (!companyId || !userId) { console.error('uso: node seed-unidad-gestion.mjs <companyId> <userId>'); process.exit(1); }

const unidad = await prisma.unidadMedida.create({
  data: { companyId, userId, codigo: 'cajon', nombre: 'Cajón', factor: new Prisma.Decimal(1), baseId: null },
  select: { id: true, codigo: true },
});
console.log('UnidadMedida creada:', JSON.stringify(unidad));
await prisma.$disconnect();
