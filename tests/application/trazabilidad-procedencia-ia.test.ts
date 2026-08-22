import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!process.env.DATABASE_URL) {
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

/**
 * T-06 — LA INGESTA DE COMPROBANTES TAMBIÉN PRODUCE DATOS TRAZABLES.
 *
 * T-01 hizo que guardar una sección —desde el formulario, el Excel o la API—
 * dejara un `DataPoint` por cada número, pasando por `datapoint-reconciler`. La
 * ingesta de documentos se quedó AFUERA: `cost-structure-populator` escribía el
 * JSON de config directo contra `CostStructure`, así que un número que la IA
 * leyó de una factura entraba al costo sin quedar registrado como dato — sin
 * autor, sin poder abrirse, y sin ninguna forma de llegar desde el número hasta
 * el papel del que salió.
 *
 * El síntoma más visible era que 'ia_sugerido' —un valor del enum `CaptureMethod`
 * desde la primera migración de trazabilidad— NUNCA se escribía: existía la
 * palabra y no existía el camino que la produjera.
 *
 * Esta prueba aprueba un documento por el camino real del populador y exige:
 *   1. que los números del documento existan como `DataPoint`,
 *   2. con método 'ia_sugerido',
 *   3. atados al `DataEntry` que los originó,
 *   4. y que la ficha del dato (`getTrace`) devuelva la procedencia leyendo la
 *      clasificación a través de ese link.
 *
 * Y la contracara, que es igual de importante: un dato cargado A MANO no trae
 * `aiProvenance` en absoluto. La ausencia del bloque es lo que apaga el sello en
 * la ficha; si apareciera vacío o en false, la pantalla dibujaría un badge de IA
 * sobre datos que tipeó una persona.
 *
 * Corre contra Postgres real: lo que se está probando son escrituras
 * transaccionales y un FK nuevo. Mockearlas probaría el mock.
 */

const HAY_BASE = Boolean(process.env.DATABASE_URL);
const suite = HAY_BASE ? describe : describe.skip;

const USER = 'ee000000-0000-4000-8000-0000000006a1';
const COMPANY = 'ee000000-0000-4000-8000-0000000006a2';
const STRUCTURE = 'ee000000-0000-4000-8000-0000000006a3';
const CONNECTION = 'ee000000-0000-4000-8000-0000000006a4';
const ENTRY = 'ee000000-0000-4000-8000-0000000006a5';
const AUDIT = 'ee000000-0000-4000-8000-0000000006a6';
const PERIOD = '2026-08';

/** Lo que la IA extrajo del comprobante, en el formato que guarda `reviewNote`. */
const reviewNote = JSON.stringify({
  sections: {
    directLabor: {
      present: true,
      workingDays: { totalDaysPerYear: 365, sundays: 52, saturdays: 52 },
      departments: [{ name: 'Corte', basicRemuneration: 480000, hoursWorked: 1600 }],
    },
  },
});

suite('T-06 — procedencia de la clasificación IA en la ficha del dato', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = new PrismaClient();
    await limpiar(db);
    const sql = [
      `INSERT INTO users (id, email, "passwordHash", name, "updatedAt")
         VALUES ('${USER}', 'traza-ia@costear.test', 'x', 'Ana Costista', now())`,
      `INSERT INTO companies (id, "userId", name, "updatedAt")
         VALUES ('${COMPANY}', '${USER}', 'Metalúrgica del Sur', now())`,
      `INSERT INTO cost_structures (id, "companyId", "userId", "productName", period, "costingSystem", "updatedAt")
         VALUES ('${STRUCTURE}', '${COMPANY}', '${USER}', 'Portón corredizo', '${PERIOD}', 'ORDERS', now())`,
      `INSERT INTO empresa_connections (id, "companyId", "costistId", "apiKey", "updatedAt")
         VALUES ('${CONNECTION}', '${COMPANY}', '${USER}', 'k-t06', now())`,
      // El documento, ya aprobado por el costista (`reviewedBy`).
      `INSERT INTO data_entries (id, "connectionId", "costistId", "rawContent", status,
                                 "fileName", "reviewNote", "reviewedBy", "reviewedAt",
                                 "costStructureId", "updatedAt")
         VALUES ('${ENTRY}', '${CONNECTION}', '${USER}', 'Liquidación de sueldos agosto', 'APPROVED',
                 'liquidacion-agosto.pdf', '${reviewNote}', '${USER}', now(),
                 '${STRUCTURE}', now())`,
      // Su clasificación, con la validación humana ya registrada — que es de
      // donde la ficha tiene que LEER la confirmación, nunca inferirla.
      `INSERT INTO classification_audits
         (id, "dataEntryId", "companyId", "costistId", "qualityGate", "definitiveSignal",
          "corroboratingSignals", "aiUsed", "documentType", "costSection", confidence,
          "requiresReview", explanation, "validatedByCostista", "costaValidatedAt", "costaOverrode")
         VALUES ('${AUDIT}', '${ENTRY}', '${COMPANY}', '${USER}', 'PASS', 'CUIT de AFIP en el encabezado',
                 '[{"label":"menciona sueldos brutos","pts":20,"type":"LIQUIDACION_MOD","layer":2}]'::jsonb,
                 false, 'LIQUIDACION_MOD', 'MANO_DE_OBRA', 91,
                 false, 'Señal definitiva: CUIT de AFIP. Confianza: 91%.', true, now(), false)`,
    ];
    for (const s of sql) await db.$executeRawUnsafe(s);
  });

  afterAll(async () => {
    if (!db) return;
    await limpiar(db);
    await db.$disconnect();
  });

  it('un documento aprobado deja sus números como DataPoint con método ia_sugerido y link al documento', async () => {
    const { populateCostStructureFromApproval } = await import(
      '@/application/validaciones/cost-structure-populator.js'
    );

    const result = await populateCostStructureFromApproval(db, {
      companyId: COMPANY,
      costistId: USER,
      costSection: 'MANO_DE_OBRA',
      reviewNote,
      supplier: null,
      costStructureId: STRUCTURE,
      amount: 480000,
      dataEntryId: ENTRY,
    });
    expect(result.populated, 'el documento no se aplicó a la estructura').toBe(true);

    const puntos = await db.dataPoint.findMany({
      where: { structureId: STRUCTURE, voidedAt: null },
      include: { versions: { orderBy: { versionN: 'desc' }, take: 1 } },
    });

    // 1. ANTES DE T-06 ESTA LÍNEA FALLABA CON 0: la ingesta escribía el JSON de
    //    la config y no creaba ni un solo dato trazable.
    expect(puntos.length, 'la ingesta no produjo ningún dato trazable').toBeGreaterThan(0);

    const remuneracion = puntos.find((p) => p.fieldKey === 'mod.dpto.Corte.remuneracion');
    expect(remuneracion, 'falta el dato de la remuneración que traía el documento').toBeDefined();

    const v = remuneracion!.versions[0]!;
    expect(Number(v.valueNum)).toBe(480000);
    // 2. El método: 'ia_sugerido' era un valor del enum que nada escribía nunca.
    expect(v.method).toBe('ia_sugerido');
    // 3. El link al documento de origen, sin el cual el método solo dice "fue
    //    una IA" y no "fue ESTA factura, clasificada así".
    expect(v.dataEntryId).toBe(ENTRY);

    // El presupuesto por centro y demás derivados NO se estampan con el
    // documento: los calcula el sistema, no salieron del papel.
    for (const p of puntos) {
      const ver = p.versions[0]!;
      if (ver.method === 'calculado') expect(ver.dataEntryId).toBeNull();
    }
  });

  it('la ficha del dato expone la procedencia leyendo la clasificación a través del documento', async () => {
    const { DataPointService } = await import('@/application/trazabilidad/data-point-service.js');
    const svc = new DataPointService(db);

    const dp = await db.dataPoint.findFirstOrThrow({
      where: { structureId: STRUCTURE, fieldKey: 'mod.dpto.Corte.remuneracion', voidedAt: null },
    });
    const trace = (await svc.getTrace(USER, dp.id)) as unknown as {
      aiProvenance?: {
        confirmado: boolean;
        confirmadoPor: string | null;
        confirmadoEl: string | null;
        corregidoPorPersona: boolean;
        confianza: string;
        requiereRevision: boolean;
        documento: { tipo: string | null; seccion: string | null; archivo: string | null };
        detalleTecnico: {
          capa: string;
          senalDeterminante: string | null;
          senalesCorroborantes: string[];
          calidadDeLectura: string | null;
          usoModeloDeLenguaje: boolean;
          explicacion: string | null;
        };
      };
    };

    expect(trace.aiProvenance, 'la ficha no expone la procedencia del dato').toBeDefined();
    const prov = trace.aiProvenance!;

    // La confirmación se LEE del rastro de validación, no se infiere del estado
    // del dato ni de que el documento esté aprobado.
    expect(prov.confirmado).toBe(true);
    expect(prov.confirmadoPor).toBe('Ana Costista');
    expect(prov.confirmadoEl).not.toBeNull();
    expect(prov.corregidoPorPersona).toBe(false);

    // CONFIANZA CUALITATIVA. El 91 no llega crudo a NINGÚN campo del sello: un
    // porcentaje se lee como "probabilidad de estar bien" y no lo es.
    expect(prov.confianza).toBe('alta');
    // `confirmadoEl` se excluye del barrido: es un timestamp del servidor, no un lugar
    // donde la confianza pueda filtrarse. Incluirlo hacía el test FLAKY — fallaba cada
    // vez que la hora contenía esos dígitos, por ejemplo "…T02:28:44.691Z". Ya se
    // verificó arriba que no es null; su formato no es lo que este test cuida.
    const sello = {
      ...prov,
      confirmadoEl: null,
      detalleTecnico: { ...prov.detalleTecnico, explicacion: null },
    };
    expect(JSON.stringify(sello)).not.toContain('91');
    // La ÚNICA excepción es `explanation`, que es el texto que ya escribió el
    // clasificador y viaja VERBATIM: es un registro de auditoría, y reescribirlo
    // para esconderle un número sería falsificarlo. Por eso vive plegado detrás
    // de "ver detalle técnico" y no en la línea del sello.
    expect(prov.detalleTecnico.explicacion).toContain('91%');

    expect(prov.documento.tipo).toBe('Liquidación de sueldos');
    expect(prov.documento.seccion).toBe('Mano de Obra Directa');
    expect(prov.documento.archivo).toBe('liquidacion-agosto.pdf');

    // Detalle técnico: la capa se nombra en castellano. "Layer 1" no significa
    // nada para un costista y suena a que algo se rompió.
    expect(prov.detalleTecnico.capa).toBe('Señal definitiva del comprobante');
    expect(prov.detalleTecnico.capa).not.toMatch(/layer/i);
    expect(prov.detalleTecnico.senalDeterminante).toBe('CUIT de AFIP en el encabezado');
    expect(prov.detalleTecnico.senalesCorroborantes).toContain('menciona sueldos brutos');
    expect(prov.detalleTecnico.calidadDeLectura).toBe('El documento se leyó completo');
    expect(prov.detalleTecnico.usoModeloDeLenguaje).toBe(false);
  });

  it('un dato cargado A MANO no trae bloque de procedencia: la ficha no dibuja ningún sello', async () => {
    const { DataPointService } = await import('@/application/trazabilidad/data-point-service.js');
    const svc = new DataPointService(db);

    const dp = await svc.create(
      USER,
      STRUCTURE,
      {
        element: 'VENTA',
        fieldKey: 'venta.precio_unitario',
        label: 'Precio unitario',
        unit: '$',
        sourceArea: 'comercial',
        method: 'manual',
        valueNum: 7200,
        reason: 'lista de precios de agosto',
      } as never,
      { id: USER, role: 'COSTISTA', area: 'costista' },
    );

    const trace = (await svc.getTrace(USER, dp.id)) as unknown as Record<string, unknown>;

    // La CLAVE no está. No es `null`, no es un objeto con banderas en false: no
    // está. El front lee esa ausencia como "acá no intervino ninguna IA".
    expect('aiProvenance' in trace).toBe(false);
    // Y el resto de la ficha sigue intacta para todo consumidor que ya existía.
    expect(trace['id']).toBe(dp.id);
    expect(trace['status']).toBe('borrador');
  });
});

async function limpiar(db: PrismaClient): Promise<void> {
  const DE_ESTE_USER = `SELECT id FROM cost_structures WHERE "userId" = '${USER}'`;
  const sql = [
    `DELETE FROM calculation_nodes WHERE "runId" IN (SELECT id FROM calculation_runs WHERE "structureId" IN (${DE_ESTE_USER}))`,
    `DELETE FROM calculation_runs WHERE "structureId" IN (${DE_ESTE_USER})`,
    `DELETE FROM trace_audit_log WHERE "actorId" = '${USER}'`,
    `DELETE FROM late_data_decisions WHERE "dataPointId" IN (SELECT id FROM data_points WHERE "structureId" IN (${DE_ESTE_USER}))`,
    // Antes que los documentos: las versiones ahora los referencian (FK NO ACTION).
    `DELETE FROM data_point_versions WHERE "dataPointId" IN (SELECT id FROM data_points WHERE "structureId" IN (${DE_ESTE_USER}))`,
    `DELETE FROM data_points WHERE "structureId" IN (${DE_ESTE_USER})`,
    `DELETE FROM classification_audits WHERE "costistId" = '${USER}'`,
    `DELETE FROM cost_ledger_entries WHERE "costistId" = '${USER}'`,
    `DELETE FROM validation_history WHERE "entryId" IN (SELECT id FROM data_entries WHERE "costistId" = '${USER}')`,
    `DELETE FROM data_entries WHERE "costistId" = '${USER}'`,
    `DELETE FROM empresa_connections WHERE "costistId" = '${USER}'`,
    `DELETE FROM cost_config_versions WHERE "structureId" IN (${DE_ESTE_USER})`,
    `DELETE FROM cost_calculations WHERE "costStructureId" IN (${DE_ESTE_USER})`,
    `DELETE FROM cost_periods WHERE "structureId" IN (${DE_ESTE_USER})`,
    `DELETE FROM audit_logs WHERE "userId" = '${USER}'`,
    `DELETE FROM cost_structures WHERE "userId" = '${USER}'`,
    `DELETE FROM companies WHERE id = '${COMPANY}'`,
    `DELETE FROM users WHERE id = '${USER}'`,
  ];
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.purge_mode', 'on', true)`);
    for (const s of sql) await tx.$executeRawUnsafe(s);
  });
}
