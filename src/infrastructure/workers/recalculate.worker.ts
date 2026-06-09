import { Worker } from 'bullmq';
import { getConnection, QUEUE_NAMES, type RecalculateJob } from './queues.js';
import { prisma } from '../database/prisma.js';
import { CostStructureService } from '../../application/cost-structures/cost-structure-service.js';
import { AlertService } from '../../application/alerts/alert-service.js';
import { EmailService } from '../email/email-service.js';

/**
 * Worker de recálculo. Ante un cambio macro significativo, recalcula todas las
 * estructuras de costos ACTIVAS. Si el margen resultante cae bajo el umbral del
 * costista, crea una alerta y le envía un email — antes de que su cliente PyME
 * venda sin margen. Esta es la promesa central de CosteAR: de 72hs a minutos.
 */
export function startRecalculateWorker(): Worker<RecalculateJob> {
  const structures = new CostStructureService();
  const alerts = new AlertService();
  const email = new EmailService();

  return new Worker<RecalculateJob>(
    QUEUE_NAMES.recalculate,
    async (job) => {
      const candidates = await prisma.costStructure.findMany({
        where: { status: 'ACTIVE' },
        include: { company: { include: { user: { include: { alertSettings: true } } } } },
      });
      // Solo las que tienen los tres bloques cargados pueden calcularse.
      const active = candidates.filter(
        (s) => s.rawMaterialConfig && s.directLaborConfig && s.indirectCostConfig,
      );

      let alerted = 0;
      for (const s of active) {
        try {
          const { result } = await structures.calculate(s.userId, s.id, {
            userId: s.userId,
          });

          const threshold = s.company.user.alertSettings
            ? Number(s.company.user.alertSettings.marginThresholdPct)
            : 15;

          if (result.grossMarginPct < threshold) {
            const created = await alerts.createMarginAlert({
              userId: s.userId,
              companyId: s.companyId,
              costStructureId: s.id,
              marginPct: result.grossMarginPct,
              thresholdPct: threshold,
              message: `El margen de ${s.productName} cayó a ${result.grossMarginPct.toFixed(1)}% (umbral ${threshold}%)`,
            });

            if (created && s.company.user.alertSettings?.emailNotifications !== false) {
              await email.sendMarginAlert(
                s.company.user.email,
                s.company.name,
                s.productName,
                result.grossMarginPct,
                threshold,
              );
              await prisma.alert.update({
                where: { id: created.id },
                data: { emailSentAt: new Date() },
              });
              alerted++;
            }
          }
        } catch (err) {
          job.log?.(`Error recalculando estructura ${s.id}: ${String(err)}`);
        }
      }

      return { recalculated: active.length, alerted };
    },
    { connection: getConnection() },
  );
}
