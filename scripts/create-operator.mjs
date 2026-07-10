import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const EMAIL = 'operator@costear.com';
const PASSWORD = 'CosteAR2026!';
const PEPPER = process.env.ARGON2_PEPPER ?? '';

async function main() {
  // 1. Find costista
  const costista = await prisma.user.findFirst({
    where: { role: 'COSTISTA' }
  });
  if (!costista) {
    console.error('No se encontró un usuario COSTISTA en la DB. Corre primero el seed.');
    return;
  }

  // 2. Find company
  const company = await prisma.company.findFirst({
    where: { name: 'Metalúrgica del Norte' }
  });
  if (!company) {
    console.error('No se encontró la empresa Metalúrgica del Norte en la DB. Corre primero el seed.');
    return;
  }

  // 3. Ensure EmpresaConnection exists
  let connection = await prisma.empresaConnection.findFirst({
    where: { companyId: company.id, costistId: costista.id }
  });
  if (!connection) {
    connection = await prisma.empresaConnection.create({
      data: {
        companyId: company.id,
        costistId: costista.id,
        apiKey: 'wilson-api-key-test',
        isActive: true,
      }
    });
    console.log('✔ Creada conexión EmpresaConnection:', connection.id);
  } else {
    console.log('✔ Conexión EmpresaConnection existente:', connection.id);
  }

  // 4. Hash password
  const passwordHash = await argon2.hash(PASSWORD + PEPPER, {
    type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4,
  });

  // 5. Create or update operator user
  const operator = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {
      passwordHash,
      role: 'EMPRESA_OPERATOR',
      mustChangePassword: false,
    },
    create: {
      email: EMAIL,
      passwordHash,
      name: 'Operario Wilson',
      role: 'EMPRESA_OPERATOR',
      mustChangePassword: false,
      isActive: true,
      onboardedAt: new Date(),
    }
  });
  console.log('✔ Creado/Actualizado usuario operador:', operator.email);

  // 6. Ensure membership exists
  const membership = await prisma.operatorMembership.upsert({
    where: {
      operatorId_connectionId: {
        operatorId: operator.id,
        connectionId: connection.id
      }
    },
    update: { isActive: true },
    create: {
      operatorId: operator.id,
      connectionId: connection.id,
      isActive: true
    }
  });
  console.log('✔ Creada membresía para el operador en la empresa.');
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
