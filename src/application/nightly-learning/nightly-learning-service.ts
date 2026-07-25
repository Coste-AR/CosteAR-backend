import { prisma } from '../../infrastructure/database/prisma.js';
import { GroqService } from '../../infrastructure/ai/groq-service.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const SYSTEM_PROMPT = `Sos un experto en sistemas RAG y metodologías de costeo para PyMEs.
Tu tarea es analizar un lote de señales de hoy originadas de diferentes fuentes (PIPELINE_NOCTURNO, COSTISTA_CHAT, VALIDACIONES_CORRECCION)
y sugerir UNA o VARIAS ediciones concretas a los archivos Markdown de la Bóveda de Costeo (CosteAR-vault).

Reglas Estrictas:
1. Devolvé SIEMPRE un JSON con el siguiente formato, sin markdown extra fuera del JSON:
{
  "proposals": [
    {
      "action": "create",
      "mergeIntoProposalId": null,
      "title": "Breve título de la propuesta (ej: Agregar concepto de Mano de Obra)",
      "sourceFile": "Ruta del archivo (ej. Costeo/Mano-de-Obra.md)",
      "proposedText": "El texto exacto en Markdown puro que sugerís agregar al final del archivo",
      "justification": "Justificación concisa para el Administrador Humano que validará esto",
      "groundedInSignals": true,
      "signalsUsedIds": ["id-senal-1", "id-senal-2"]
    }
  ]
}
2. Si las señales son irrelevantes (ej: saludos o spam), devolvé un array vacío \`[]\`.
3. Tu propuesta NO se aplicará automáticamente. Será revisada por un Humano. Asegurate de que el 'proposedText' sea perfecto, con buena ortografía y formato Markdown (listas, negritas).
4. CERO ALUCINACIONES: "groundedInSignals" debe ser \`true\` ÚNICAMENTE si el 'proposedText' es una transcripción fiel de lo que un costista escribió en una señal de tipo USER_CORRECTION o IMPROVEMENT_REPORT (contenido humano real). Si la señal es un RAG_MISS (una pregunta que nadie contestó) y tuviste que redactar la definición o explicación usando TU PROPIO conocimiento general (no un texto que un humano haya escrito en las señales), "groundedInSignals" DEBE ser \`false\`. No inventes definiciones técnicas específicas de la cátedra (siglas, fórmulas, porcentajes) y las marques como confiables — es preferible marcar \`false\` y dejar que un humano la redacte o la verifique.
5. SIN PROPUESTAS DUPLICADAS: te paso una lista de "PROPUESTAS YA PENDIENTES DE VALIDACIÓN" (todavía no las revisó un humano). Antes de crear una propuesta nueva, fijate si el tema de la señal YA está cubierto por alguna de esas propuestas pendientes (aunque el archivo destino o el título estén redactados distinto — juzgá por el TEMA, no por coincidencia textual exacta). Si ya está cubierto: usá "action": "merge", poné el id de la propuesta existente en "mergeIntoProposalId", y dejá "title"/"sourceFile"/"proposedText"/"justification" como string vacío "" (no se usan en un merge, solo importa "signalsUsedIds"). Si es un tema nuevo: usá "action": "create" y "mergeIntoProposalId": null como en el ejemplo.`;

export class NightlyLearningService {
  constructor(private readonly ai: GroqService = new GroqService()) {}

  async runNightlyPipeline(): Promise<void> {
    if (!this.ai.isConfigured) {
      console.warn('GroqService no configurado. Skiping nightly pipeline.');
      return;
    }

    // 1. Buscar todas las señales pendientes
    const pendingSignals = await prisma.dailySignal.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' }
    });

    if (pendingSignals.length === 0) {
      console.info('No hay señales diarias para procesar.');
      return;
    }

    // 2. Armar el prompt con todas las señales (batch simple para V1)
    let signalsStr = '';
    for (const signal of pendingSignals) {
      signalsStr += `ID: ${signal.id} | Origen: ${signal.source} | Tipo: ${signal.type} | Contenido: ${signal.content}\n`;
    }

    // Propuestas que ya están esperando revisión humana — se las pasamos al LLM
    // para que no genere una segunda propuesta sobre el mismo tema en cada corrida.
    const existingPending = await prisma.vaultEditProposal.findMany({
      where: { status: 'PENDING' },
      select: { id: true, title: true, sourceFile: true, proposedText: true }
    });
    const existingPendingStr = existingPending.length === 0
      ? '(ninguna)'
      : existingPending
          .map((p) => `ID: ${p.id} | Archivo: ${p.sourceFile} | Título: ${p.title} | Extracto: ${p.proposedText.slice(0, 140)}`)
          .join('\n');

    const userPrompt = `SEÑALES RECOPILADAS HOY:\n\n${signalsStr}\n\nPROPUESTAS YA PENDIENTES DE VALIDACIÓN:\n\n${existingPendingStr}\n\nAnalizá estas señales y devolvé las propuestas de edición JSON.`;

    // 3. Consultar a Groq AI
    const result = await this.ai.completeJSON<{
      proposals: {
        action: 'create' | 'merge';
        mergeIntoProposalId: string | null;
        title: string;
        sourceFile: string;
        proposedText: string;
        justification: string;
        groundedInSignals: boolean;
        signalsUsedIds: string[];
      }[];
    }>(SYSTEM_PROMPT, userPrompt);

    if (!result || !result.proposals) {
      console.error('El LLM no devolvió propuestas válidas o falló la respuesta.');
      return;
    }

    // 4. Guardar las propuestas: si el LLM pidió "merge" contra una propuesta pendiente
    // real, solo sumamos trazabilidad (signalsUsed) sin crear una fila nueva. Si pidió
    // "merge" contra un ID inválido (alucinado), lo tratamos como "create" igual —
    // preferimos una propuesta de más antes que perder la señal silenciosamente.
    const pendingIds = new Set(existingPending.map((p) => p.id));
    const createdProposals: { title: string; sourceFile: string; justification: string; groundedInSignals: boolean }[] = [];
    for (const prop of result.proposals) {
      if (prop.action === 'merge' && prop.mergeIntoProposalId && pendingIds.has(prop.mergeIntoProposalId)) {
        const target = await prisma.vaultEditProposal.findUnique({ where: { id: prop.mergeIntoProposalId } });
        if (target) {
          const mergedSignals = Array.from(new Set([...target.signalsUsed, ...prop.signalsUsedIds]));
          await prisma.vaultEditProposal.update({
            where: { id: prop.mergeIntoProposalId },
            data: { signalsUsed: mergedSignals }
          });
        }
        continue;
      }

      await prisma.vaultEditProposal.create({
        data: {
          title: prop.title,
          sourceFile: prop.sourceFile,
          proposedText: prop.proposedText,
          justification: prop.justification,
          signalsUsed: prop.signalsUsedIds,
          status: 'PENDING',
          requiresVerification: !prop.groundedInSignals
        }
      });
      createdProposals.push({ title: prop.title, sourceFile: prop.sourceFile, justification: prop.justification, groundedInSignals: prop.groundedInSignals });
    }

    // 5. Marcar las señales procesadas
    const processedIds = result.proposals.flatMap(p => p.signalsUsedIds);
    if (processedIds.length > 0) {
      await prisma.dailySignal.updateMany({
        where: { id: { in: processedIds } },
        data: { status: 'PROCESSED' }
      });
    }
    
    // Marcar las señales NO procesadas (basura) como REJECTED
    const rejectedIds = pendingSignals.map(s => s.id).filter(id => !processedIds.includes(id));
    if (rejectedIds.length > 0) {
      await prisma.dailySignal.updateMany({
        where: { id: { in: rejectedIds } },
        data: { status: 'REJECTED' }
      });
    }

    // 6. Generar el Reporte Nocturno en Obsidian
    try {
      const vaultPath = process.env.VAULT_PATH ?? path.resolve(process.cwd(), '../CosteAR-vault');
      const reportsDir = path.join(vaultPath, 'Reportes_Nocturnos');
      await fs.mkdir(reportsDir, { recursive: true });
      
      const todayDate = new Date().toISOString().split('T')[0];
      const reportFile = path.join(reportsDir, `${todayDate}-Resumen.md`);
      
      const mergedCount = result.proposals.length - createdProposals.length;

      let reportContent = `# Reporte Nocturno: ${todayDate}\n\n`;
      reportContent += `**Señales procesadas:** ${pendingSignals.length}\n`;
      reportContent += `**Propuestas nuevas:** ${createdProposals.length}\n`;
      if (mergedCount > 0) {
        reportContent += `**Señales fusionadas a propuestas ya pendientes (sin duplicar):** ${mergedCount}\n`;
      }
      reportContent += `\n`;

      if (createdProposals.length > 0) {
        reportContent += `## Propuestas esperando Validación Humana\n\n`;
        for (const p of createdProposals) {
          reportContent += `### ${p.title}\n`;
          reportContent += `- **Archivo Destino:** \`${p.sourceFile}\`\n`;
          reportContent += `- **Justificación IA:** ${p.justification}\n`;
          if (!p.groundedInSignals) {
            reportContent += `- ⚠️ **Requiere verificación:** este texto lo redactó la IA sin una corrección humana de base. Revisar antes de aprobar.\n`;
          }
          reportContent += `\n`;
        }
      } else {
        reportContent += `No se encontraron señales útiles para generar propuestas de mejora hoy.\n`;
      }
      
      reportContent += `\n> *Este reporte fue autogenerado por el Nightly Learning Pipeline de CosteAR.*\n`;
      
      await fs.writeFile(reportFile, reportContent, 'utf-8');
      console.info(`[nightly-learning] Reporte generado en ${reportFile}`);
    } catch (err) {
      console.error('[nightly-learning] Error escribiendo el reporte nocturno:', err);
    }

    console.info(`Nightly Pipeline terminado. ${createdProposals.length} propuestas nuevas, ${result.proposals.length - createdProposals.length} fusionadas.`);
    
    // Al final del pipeline nocturno, disparamos el indexador para mantener las embeddings actualizadas
    // por si hubo commits manuales en la Bóveda durante el día.
    try {
      console.info('[nightly-learning] Iniciando reindexación automática de la Bóveda...');
      const { VaultIndexerService } = await import('../vault-indexer/vault-indexer-service.js');
      const vaultPath = process.env.VAULT_PATH || '../CosteAR-vault';
      const resolvedVaultPath = path.resolve(vaultPath);
      const indexer = new VaultIndexerService();
      const indexResult = await indexer.indexVault(resolvedVaultPath);
      console.info(`[nightly-learning] Reindexación completada: ${indexResult.chunksUpserted} chunks nuevos/actualizados.`);
    } catch (err) {
      console.error('[nightly-learning] Error en la reindexación nocturna:', err);
    }
  }
}
