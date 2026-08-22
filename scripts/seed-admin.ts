import { prisma } from '../src/infrastructure/database/prisma.js';
import { hashPassword } from '../src/infrastructure/crypto/password.js';

async function main() {
  const adminEmail = 'giulianadiroccodev@gmail.com';
  const adminPassword = 'admin123';

  console.log(`Buscando usuario ${adminEmail}...`);
  const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (existingUser) {
    const passwordHash = await hashPassword(adminPassword);
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { role: 'ADMIN', passwordHash }
    });
    console.log(`Usuario actualizado a rol ADMIN con nueva contraseña.`);

  } else {
    console.log(`Creando usuario Súper Administrador por defecto...`);
    const passwordHash = await hashPassword(adminPassword);
    
    // Necesitamos una empresa por defecto o se puede crear el usuario sin company?
    // Según el esquema, companyId es opcional, así que podemos crearlo sin empresa asociada 
    // o con una genérica si fuera necesario, pero el admin principal puede operar suelto.
    
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        name: 'Giuliana Di Rocco',
        role: 'ADMIN'
      }
    });
    console.log(`Súper Administrador creado exitosamente: ${adminEmail} / ${adminPassword}`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
