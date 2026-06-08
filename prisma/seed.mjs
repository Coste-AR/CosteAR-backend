// Seed de datos demo para CosteAR.
// Crea un costista de prueba + 2 PyMEs, una con una estructura de costos
// completa (ejemplo de la cátedra) lista para calcular.
//
// Uso: node prisma/seed.mjs
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@costear.com';
const DEMO_PASSWORD = 'CosteAR2026!';
const PEPPER = process.env.ARGON2_PEPPER ?? '';

const catedra = {
  rawMaterialConfig: {
    wilson: { annualDemand: 24000, orderCost: 3500, holdingRate: 0.3, unitCost: 800 },
    stockPolicy: { minConsumption: 40, maxConsumption: 90, minLeadTime: 8, maxLeadTime: 12, safetyStock: 200 },
    initialStock: { quantity: 300, unitCost: 800 },
    movements: [
      { date: '2026-05-02', type: 'purchase', detail: 'Factura A-101', quantity: 500, unitCost: 850 },
      { date: '2026-05-08', type: 'consumption', detail: 'Orden Prod. 01', quantity: 400 },
      { date: '2026-05-15', type: 'purchase', detail: 'Factura A-118', quantity: 600, unitCost: 900 },
      { date: '2026-05-24', type: 'consumption', detail: 'Orden Prod. 02', quantity: 700 },
    ],
  },
  directLaborConfig: {
    workingDays: { totalDaysPerYear: 365, nonWorkingDays: 115, vacationDays: 14, averageAbsenceDays: 6 },
    socialCharges: [
      { name: 'Jubilación', percent: 16 }, { name: 'Obra social', percent: 6 },
      { name: 'ART', percent: 5 }, { name: 'SAC s/cargas', percent: 9 },
      { name: 'Vacaciones', percent: 6 }, { name: 'Otros', percent: 8 },
    ],
    departments: [
      { departmentName: 'Armado', workers: 5, monthlyWage: 400000, hoursPerDay: 8 },
      { departmentName: 'Pintura', workers: 3, monthlyWage: 350000, hoursPerDay: 8 },
    ],
  },
  indirectCostConfig: {
    centers: [
      { id: 'prod1', name: 'Armado', type: 'productive' },
      { id: 'prod2', name: 'Pintura', type: 'productive' },
      { id: 'serv1', name: 'Mantenimiento', type: 'service' },
    ],
    concepts: [
      { name: 'Alquiler', amount: { fixed: 300000, variable: 0 }, distribution: { prod1: 50, prod2: 30, serv1: 20 } },
      { name: 'Energía', amount: { fixed: 0, variable: 180000 }, distribution: { prod1: 40, prod2: 50, serv1: 10 } },
    ],
    serviceDistributions: [{ serviceCenterId: 'serv1', toProductive: { prod1: 60, prod2: 40 } }],
    productiveSettings: [
      { centerId: 'prod1', budget: { fixed: 200000, variable: 120000 }, normalCapacity: 9200, actualActivity: 9000, actualCip: 325000 },
      { centerId: 'prod2', budget: { fixed: 150000, variable: 90000 }, normalCapacity: 5520, actualActivity: 5400, actualCip: 245000 },
    ],
  },
};

async function main() {
  const passwordHash = await argon2.hash(DEMO_PASSWORD + PEPPER, {
    type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4,
  });

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL, passwordHash, name: 'Costista Demo',
      alertSettings: { create: { marginThresholdPct: 15 } },
    },
  });

  const metalurgica = await prisma.company.create({
    data: { userId: user.id, name: 'Metalúrgica del Norte', industry: 'Manufactura', cuit: '20123456786' },
  });
  await prisma.company.create({
    data: { userId: user.id, name: 'Agroindustria Tucumán', industry: 'Agroindustria' },
  });

  await prisma.costStructure.create({
    data: {
      companyId: metalurgica.id, userId: user.id,
      productName: 'Estructura metálica tipo A', period: '2026-06', status: 'ACTIVE',
      salesUnitPrice: 12000, salesQuantity: 1200,
      ...catedra,
    },
  });

  console.info('✔ Seed completo');
  console.info(`  Usuario:    ${DEMO_EMAIL}`);
  console.info(`  Contraseña: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
