// Migración de datos existentes a la Trazabilidad Total v1 (spec sección A).
//
// Por cada CostStructure que ya tiene configuración cargada (pre-existente al
// sistema de trazabilidad), crea un DataPoint + DataPointVersion(v1) por cada
// bloque (MP/MOD/CIP/VENTA) con method='manual', reason='migración: dato
// pre-trazabilidad' y actorRole='desconocido (migrado)' porque el modelo
// legado no registra quién cargó cada campo individual — solo quién es dueño
// de la estructura. Ver DECISIONES.md: granularidad por bloque (no por campo
// individual) es el default más simple que cumple la spec sin inventar datos
// que no existen.
//
// Idempotente: si una estructura ya tiene un DataPoint con ese fieldKey, la
// saltea. Se puede correr las veces que haga falta.
//
// Uso: node scripts/backfill-trazabilidad.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BLOCKS = [
  { fieldKey: 'mp.config', element: 'MP', label: 'Configuración de Materia Prima (migrada)', configField: 'rawMaterialConfig' },
  { fieldKey: 'mod.config', element: 'MOD', label: 'Configuración de Mano de Obra Directa (migrada)', configField: 'directLaborConfig' },
  { fieldKey: 'cip.config', element: 'CIP', label: 'Configuración de Costos Indirectos (migrada)', configField: 'indirectCostConfig' },
];

async function main() {
  const structures = await prisma.costStructure.findMany({
    where: {
      OR: [
        { rawMaterialConfig: { not: null } },
        { directLaborConfig: { not: null } },
        { indirectCostConfig: { not: null } },
        { salesUnitPrice: { not: null } },
      ],
    },
  });

  console.log(`Encontradas ${structures.length} estructuras con datos pre-trazabilidad.`);

  let created = 0;
  let skipped = 0;

  for (const s of structures) {
    for (const block of BLOCKS) {
      const value = s[block.configField];
      if (value === null || value === undefined) continue;

      const existing = await prisma.dataPoint.findFirst({
        where: { structureId: s.id, fieldKey: block.fieldKey },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const dp = await tx.dataPoint.create({
          data: {
            structureId: s.id,
            element: block.element,
            fieldKey: block.fieldKey,
            label: block.label,
            sourceArea: 'costista',
            status: 'aplicado',
            fechaCaptacion: s.createdAt,
            periodoImputado: s.period,
            createdAt: s.createdAt,
          },
        });
        await tx.dataPointVersion.create({
          data: {
            dataPointId: dp.id,
            versionN: 1,
            valueJson: value,
            reason: 'migración: dato pre-trazabilidad',
            method: 'manual',
            createdBy: s.userId,
            actorRole: 'desconocido (migrado)',
            actorArea: 'costista',
            createdAt: s.createdAt,
          },
        });
        await tx.traceAuditLog.create({
          data: {
            entityType: 'DataPoint',
            entityId: dp.id,
            action: 'crear',
            actorId: s.userId,
            actorRole: 'desconocido (migrado)',
            actorArea: 'costista',
            method: 'manual',
            comment: 'Backfill automático — dato pre-existente al sistema de trazabilidad',
            after: { fieldKey: block.fieldKey },
          },
        });
      });
      created++;
    }

    // Venta: dos data points hermanos, mismo patrón que MP (cantidad/precio),
    // solo si hay datos de venta cargados.
    if (s.salesUnitPrice !== null || s.salesQuantity !== null) {
      const existing = await prisma.dataPoint.findFirst({
        where: { structureId: s.id, fieldKey: 'venta.config' },
      });
      if (!existing) {
        await prisma.$transaction(async (tx) => {
          const dp = await tx.dataPoint.create({
            data: {
              structureId: s.id,
              element: 'VENTA',
              fieldKey: 'venta.config',
              label: 'Precio y cantidad de venta (migrado)',
              sourceArea: 'comercial',
              status: 'aplicado',
              fechaCaptacion: s.createdAt,
              periodoImputado: s.period,
              createdAt: s.createdAt,
            },
          });
          await tx.dataPointVersion.create({
            data: {
              dataPointId: dp.id,
              versionN: 1,
              valueJson: {
                salesUnitPrice: s.salesUnitPrice ? Number(s.salesUnitPrice) : null,
                salesQuantity: s.salesQuantity ? Number(s.salesQuantity) : null,
              },
              reason: 'migración: dato pre-trazabilidad',
              method: 'manual',
              createdBy: s.userId,
              actorRole: 'desconocido (migrado)',
              actorArea: 'comercial',
              createdAt: s.createdAt,
            },
          });
          await tx.traceAuditLog.create({
            data: {
              entityType: 'DataPoint',
              entityId: dp.id,
              action: 'crear',
              actorId: s.userId,
              actorRole: 'desconocido (migrado)',
              actorArea: 'comercial',
              method: 'manual',
              comment: 'Backfill automático — dato pre-existente al sistema de trazabilidad',
              after: { fieldKey: 'venta.config' },
            },
          });
        });
        created++;
      } else {
        skipped++;
      }
    }
  }

  console.log(`Listo. Creados: ${created}. Ya existían (salteados): ${skipped}.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
