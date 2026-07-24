import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { getEnv } from './src/infrastructure/config/env.js';

const prisma = new PrismaClient();

async function run() {
  const users = await prisma.user.findMany();
  console.log('Users in DB:', users.map(u => u.email + ' - ' + u.role));
  
  if (users.length === 0) return;
  const admin = users[0];
  
  const token = jwt.sign(
    { sub: admin.id, role: admin.role, email: admin.email, type: 'access' },
    getEnv('JWT_PRIVATE_KEY'),
    { algorithm: 'RS256', expiresIn: '15m' }
  );

  const res = await fetch('http://localhost:3000/api/v1/admin/stats', {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  const data = await res.json();
  console.log('Stats from API:', JSON.stringify(data, null, 2));

  console.log('Triggering manual index...');
  const indexRes = await fetch('http://localhost:3000/api/v1/vault/index', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  
  const indexData = await indexRes.json();
  console.log('Index result:', JSON.stringify(indexData, null, 2));

  const res2 = await fetch('http://localhost:3000/api/v1/admin/stats', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data2 = await res2.json();
  console.log('Stats after index:', JSON.stringify(data2, null, 2));
}

run().catch(console.error).finally(() => prisma.$disconnect());
