// Seed de datos demo para CosteAR.
// Crea un costista de prueba + 2 PyMEs, una con una estructura de costos
// completa (ejemplo de la cátedra) lista para calcular.
//
// Uso: node prisma/seed.mjs
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_EMAIL = process.env.COSTEAR_USER;
const DEMO_PASSWORD = process.env.COSTEAR_PASS;
const PEPPER = process.env.ARGON2_PEPPER ?? '';

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Falta ${name}. Definila en el entorno antes de ejecutar el seed.`);
  }
  return value;
}

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
    workingDays: {
      totalDaysPerYear: 365,
      unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 3, holidaysOnWeekend: 4 },
      paidAbsence: { holidays: 19, vacations: 14, sickness: 5, specialLeaves: 2, workAccidents: 1 },
    },
    itcs: {
      derivationBase: 0.27, fixedArt: 0.015,
      uncertainRemunerative: [
        { name: 'Premio por Productividad', coefficient: 0.03 },
        { name: 'Antigüedad', coefficient: 0.04 },
        { name: 'Premio por Asistencia Perfecta', coefficient: 0.02 },
      ],
      uncertainNonRemunerative: [
        { name: 'Ropa de trabajo', coefficient: 0.01 },
        { name: 'Viandas / comedor', coefficient: 0.015 },
        { name: 'Medicamentos', coefficient: 0.005 },
      ],
    },
    departments: [
      { name: 'Departamento Productivo 1', basicRemuneration: 4500000, hoursWorked: 12000 },
      { name: 'Departamento Productivo 2', basicRemuneration: 3200000, hoursWorked: 9000 },
      { name: 'Departamento Productivo 3', basicRemuneration: 2800000, hoursWorked: 8000 },
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
  const demoEmail = requireEnv('COSTEAR_USER', DEMO_EMAIL);
  const demoPassword = requireEnv('COSTEAR_PASS', DEMO_PASSWORD);
  const passwordHash = await argon2.hash(demoPassword + PEPPER, {
    type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4,
  });

  const user = await prisma.user.upsert({
    where: { email: demoEmail },
    update: {},
    create: {
      email: demoEmail, passwordHash, name: 'Costista Demo',
      cuit: '20123456786', dni: '12345678',
      professionalType: 'CONTADOR_PUBLICO', province: 'Tucumán',
      onboardedAt: new Date(),
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
  console.info(`  Usuario: ${demoEmail}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
