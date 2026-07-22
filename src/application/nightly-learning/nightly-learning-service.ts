import { prisma } from '../../infrastructure/database/prisma.js';
import { GroqService } from '../../infrastructure/ai/groq-service.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const SYSTEM_PROMPT = `Sos un experto en sistemas RAG y metodologías de costeo para PyMEs.
Tu tarea es analizar un lote de señales de hoy (preguntas sin respuesta del RAG, y sugerencias/correcciones de los usuarios)
y sugerir UNA o VARIAS ediciones concretas a los archivos Markdown de la Bóveda de Costeo (CosteAR-vault).

Reglas Estrictas:
1. Devolvé SIEMPRE un JSON con el siguiente formato, sin markdown extra fuera del JSON:
{
  "proposals": [
    {
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
4. CERO ALUCINACIONES: "groundedInSignals" debe ser \`true\` ÚNICAMENTE si el 'proposedText' es una transcripción fiel de lo que un costista escribió en una señal de tipo USER_CORRECTION o IMPROVEMENT_REPORT (contenido humano real). Si la señal es un RAG_MISS (una pregunta que nadie contestó) y tuviste que redactar la definición o explicación usando TU PROPIO conocimiento general (no un texto que un humano haya escrito en las señales), "groundedInSignals" DEBE ser \`false\`. No inventes definiciones técnicas específicas de la cátedra (siglas, fórmulas, porcentajes) y las marques como confiables — es preferible marcar \`false\` y dejar que un humano la redacte o la verifique.`;

export class NightlyLearningService {
  private ai: GroqService;

  constructor() {
    this.ai = new GroqService();
  }

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
      signalsStr += `ID: ${signal.id} | Tipo: ${signal.type} | Contenido: ${signal.content}\n`;
    }

    const userPrompt = `SEÑALES RECOPILADAS HOY:\n\n${signalsStr}\n\nAnalizá estas señales y devolvé las propuestas de edición JSON.`;

    // 3. Consultar a Groq AI
    const result = await this.ai.completeJSON<{
      proposals: {
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

    // 4. Guardar las propuestas como Pending VaultEditProposals
    for (const prop of result.proposals) {
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
      
      let reportContent = `# Reporte Nocturno: ${todayDate}\n\n`;
      reportContent += `**Señales procesadas:** ${pendingSignals.length}\n`;
      reportContent += `**Propuestas generadas:** ${result.proposals.length}\n\n`;
      
      if (result.proposals.length > 0) {
        reportContent += `## Propuestas esperando Validación Humana\n\n`;
        for (const p of result.proposals) {
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

    console.info(`Nightly Pipeline terminado. ${result.proposals.length} propuestas generadas.`);
  }
}
