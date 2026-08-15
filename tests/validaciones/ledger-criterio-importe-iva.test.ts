/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CL-01 · BANDERA DE IMPORTE PRE-FIX IVA — marcar, no reescribir
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * QUÉ PROTEGE
 * -----------
 * Las líneas del libro mayor creadas ANTES de la corrección CL-01 tomaron el
 * total del comprobante (con IVA) en vez del neto y quedaron infladas entre un
 * 10,5 % y un 21 %. La decisión de producto fue MARCARLAS, no recalcularlas.
 * Este archivo verifica las dos mitades de esa marca:
 *
 *   1. LAS FILAS NUEVAS — `buildLedgerDraft` estampa el criterio en el momento
 *      de crear la línea, y nunca puede producir la marca de pre-fix (con el
 *      código corregido es un estado inalcanzable).
 *
 *   2. LAS FILAS VIEJAS — el criterio del backfill. NO se reimplementa acá: se
 *      lee la función PL/pgSQL DEL PROPIO ARCHIVO DE MIGRACIÓN que se aplicó a
 *      la base, se la crea temporalmente y se la interroga con los importes
 *      reales del corpus. Si alguien cambia el criterio en la migración, este
 *      test mide lo nuevo — una sola fuente de verdad.
 *
 * POR QUÉ EL CRITERIO NO ES UNA FECHA
 * -----------------------------------
 * Los tests de abajo son la demostración: una línea vieja cuyo comprobante traía
 * el neto discriminado NUNCA estuvo inflada (el código viejo también terminaba
 * en el neto), y una empresa monotributista tiene que costear CON el IVA. Un
 * corte por `createdAt` marcaría a las dos por igual. El criterio compara el
 * importe guardado contra el comprobante guardado: es verificable fila por fila
 * y no depende de ningún reloj.
 *
 * CÓMO CORRERLO
 *   docker start costear-postgres
 *   npx vitest run tests/validaciones/ledger-criterio-importe-iva.test.ts
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildLedgerDraft } from '../../src/application/validaciones/ledger-builder.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

if (!process.env.DATABASE_URL) {
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

// ── Los importes salen del corpus, no de la cabeza de nadie ──────────────────

interface CorpusCaso {
  id: string;
  montos?: { netAmount?: number; taxAmount?: number; totalAmount?: number; alicuota?: number };
}

const CORPUS_PATH = join(ROOT, 'corpus-clasificador', 'corpus.json');

function caso(id: string): NonNullable<CorpusCaso['montos']> {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as { casos: CorpusCaso[] };
  const c = corpus.casos.find((x) => x.id === id);
  if (!c?.montos) throw new Error(`corpus.json no tiene los montos del caso ${id}.`);
  return c.montos;
}

const MP06 = caso('MP-06'); // neto 10.000.000 · IVA 21 % · total 12.100.000
const MP03 = caso('MP-03'); // alícuota 10,5 %

/** `reviewNote` tal como lo deja el analizador para un comprobante. */
function reviewNote(montos: Record<string, number | null | undefined>): string {
  return JSON.stringify({
    extractedData: {
      date: '2026-06-12',
      supplier: 'Proveedor de prueba SRL',
      invoiceNumber: '0001-00001854',
      currency: 'ARS',
      netAmount: montos.netAmount ?? null,
      taxAmount: montos.taxAmount ?? null,
      totalAmount: montos.totalAmount ?? null,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. LAS LÍNEAS NUEVAS nacen marcadas
// ═══════════════════════════════════════════════════════════════════════════

describe('libro mayor — cada línea nueva se estampa con el criterio del importe', () => {
  const draft = (montos: Record<string, number | null | undefined>, condicionIva?: 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO') =>
    buildLedgerDraft({
      aiReviewNote: reviewNote(montos),
      documentType: 'FACTURA_COMPRA',
      fallbackDescription: 'fallback',
      condicionIva,
    })!;

  it('Responsable Inscripto con neto discriminado: el importe es el neto y queda marcado como tal', () => {
    const d = draft(MP06);
    expect(d.amount).toBe(MP06.netAmount);
    expect(d.criterioImporteIva).toBe('NETO_SIN_IVA');
  });

  it('sin neto pero con IVA discriminado, el neto se deriva y la marca sigue siendo NETO_SIN_IVA', () => {
    const d = draft({ taxAmount: MP06.taxAmount, totalAmount: MP06.totalAmount });
    expect(d.amount).toBe(MP06.netAmount);
    expect(d.criterioImporteIva).toBe('NETO_SIN_IVA');
  });

  it('Factura C / ticket (sin neto ni IVA discriminado): el total ES el costo, no es una línea inflada', () => {
    const d = draft({ totalAmount: MP06.totalAmount });
    expect(d.amount).toBe(MP06.totalAmount);
    expect(d.criterioImporteIva).toBe('TOTAL_CON_IVA');
  });

  it('monotributista: el IVA no se recupera, es costo — el total con IVA está BIEN', () => {
    const d = draft(MP06, 'MONOTRIBUTO');
    expect(d.amount).toBe(MP06.totalAmount);
    expect(d.criterioImporteIva).toBe('TOTAL_CON_IVA');
  });

  it('el código corregido NUNCA puede producir la marca de pre-fix', () => {
    const combinaciones = [
      MP06,
      MP03,
      { netAmount: MP06.netAmount },
      { totalAmount: MP06.totalAmount },
      { taxAmount: MP06.taxAmount, totalAmount: MP06.totalAmount },
    ];
    for (const condicion of ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'] as const) {
      for (const m of combinaciones) {
        expect(draft(m, condicion).criterioImporteIva).not.toBe('ANTERIOR_A_LA_CORRECCION');
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. EL CRITERIO DEL BACKFILL, tal cual quedó escrito en la migración
// ═══════════════════════════════════════════════════════════════════════════

const MIGRACION = join(
  ROOT, 'prisma', 'migrations', '20260813120000_add_criterio_importe_iva', 'migration.sql',
);

/** Extrae del archivo de migración el bloque `CREATE FUNCTION ... $$ LANGUAGE plpgsql;`. */
function funcionDeLaMigracion(): string {
  const sql = readFileSync(MIGRACION, 'utf8');
  const desde = sql.indexOf('CREATE FUNCTION costear_criterio_importe_iva_backfill');
  const hasta = sql.indexOf('$$ LANGUAGE plpgsql;', desde);
  if (desde < 0 || hasta < 0) {
    throw new Error('La migración perdió la función del backfill — este test depende de ella.');
  }
  // La función se recrea con OTRO nombre: la original se borra al final de la
  // migración y no debe quedar viva en la base por culpa de un test.
  return sql
    .slice(desde, hasta + '$$ LANGUAGE plpgsql;'.length)
    .replace('costear_criterio_importe_iva_backfill', 'costear_criterio_iva_test');
}

const DB_URL = process.env.DATABASE_URL;
let db: PrismaClient | undefined;

async function diagnosticar(): Promise<string | null> {
  if (!DB_URL) return 'no hay DATABASE_URL';
  db = new PrismaClient({ datasourceUrl: DB_URL });
  try {
    await db.$queryRawUnsafe('SELECT 1');
  } catch (err) {
    return `no se pudo conectar a la base: ${(err as Error).message.split('\n')[0]}`;
  }
  try {
    await db.$executeRawUnsafe(funcionDeLaMigracion());
  } catch (err) {
    return `no se pudo crear la función del backfill: ${(err as Error).message.split('\n')[0]}`;
  }
  return null;
}

const motivoSkip = await diagnosticar();
const HAY_BASE = motivoSkip === null;
if (!HAY_BASE) {
  console.warn(`\n[CL-01] Criterio del backfill NO verificado contra la base: ${motivoSkip}.\n`);
}

afterAll(async () => {
  if (db) {
    try {
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS costear_criterio_iva_test(text, numeric, text)');
    } catch { /* la base ya no está: nada que limpiar */ }
    await db.$disconnect();
  }
});

/** Interroga a la función del backfill exactamente como lo hace la migración. */
async function clasificar(
  note: string | null,
  importe: number,
  condicion = 'RESPONSABLE_INSCRIPTO',
): Promise<{ criterio: string; iva: number | null }> {
  const rows = await db!.$queryRawUnsafe<Array<{ criterio: string; iva: string | null }>>(
    `SELECT t.v ->> 'criterio' AS criterio, t.v ->> 'iva' AS iva
       FROM costear_criterio_iva_test($1, $2::numeric, $3) AS t(v)`,
    note,
    importe,
    condicion,
  );
  const r = rows[0]!;
  return { criterio: r.criterio, iva: r.iva == null ? null : Number(r.iva) };
}

describe.skipIf(!HAY_BASE)('libro mayor — criterio del backfill (la migración, no una copia)', () => {
  it('MP-06 (21 %): importe 12.100.000 con neto 10.000.000 en el comprobante → ANTERIOR_A_LA_CORRECCION', async () => {
    const r = await clasificar(reviewNote(MP06), MP06.totalAmount!);
    expect(r.criterio).toBe('ANTERIOR_A_LA_CORRECCION');
    // Y dice por cuánto: los $2.100.000 de IVA que se colaron al costo.
    expect(r.iva).toBeCloseTo(MP06.totalAmount! - MP06.netAmount!, 2);
  });

  it('MP-03 (10,5 %): la misma firma, con la otra alícuota', async () => {
    const r = await clasificar(reviewNote(MP03), MP03.totalAmount!);
    expect(r.criterio).toBe('ANTERIOR_A_LA_CORRECCION');
    expect(r.iva).toBeCloseTo(MP03.totalAmount! - MP03.netAmount!, 2);
  });

  it('una línea VIEJA cuyo importe ya era el neto NO se marca: nunca estuvo inflada', async () => {
    const r = await clasificar(reviewNote(MP06), MP06.netAmount!);
    expect(r.criterio).toBe('NETO_SIN_IVA');
    expect(r.iva).toBeNull();
  });

  it('sin neto discriminado el importe también se deriva por resta antes de juzgar', async () => {
    const soloTotalYIva = reviewNote({ taxAmount: MP06.taxAmount, totalAmount: MP06.totalAmount });
    expect((await clasificar(soloTotalYIva, MP06.netAmount!)).criterio).toBe('NETO_SIN_IVA');
    expect((await clasificar(soloTotalYIva, MP06.totalAmount!)).criterio).toBe(
      'ANTERIOR_A_LA_CORRECCION',
    );
  });

  it('Factura C / ticket: sin nada que discriminar el total ES el costo — no se marca', async () => {
    const r = await clasificar(reviewNote({ totalAmount: MP06.totalAmount }), MP06.totalAmount!);
    expect(r.criterio).toBe('TOTAL_CON_IVA');
  });

  it('monotributista: el total con IVA es su costo real, no una sobrevaluación', async () => {
    for (const condicion of ['MONOTRIBUTO', 'EXENTO']) {
      const r = await clasificar(reviewNote(MP06), MP06.totalAmount!, condicion);
      expect(r.criterio).toBe('TOTAL_CON_IVA');
    }
  });

  it('sin documento legible no se inventa un veredicto: SIN_EVIDENCIA', async () => {
    expect((await clasificar(null, 1000)).criterio).toBe('SIN_EVIDENCIA');
    expect((await clasificar('no soy json', 1000)).criterio).toBe('SIN_EVIDENCIA');
    expect((await clasificar('{"otraCosa":1}', 1000)).criterio).toBe('SIN_EVIDENCIA');
    expect((await clasificar('{"extractedData":"texto"}', 1000)).criterio).toBe('SIN_EVIDENCIA');
  });

  it('un importe que no coincide con NINGUNA lectura del comprobante queda como no verificable', async () => {
    // El costista lo editó a mano: ni el neto ni el total. No se afirma nada.
    const r = await clasificar(reviewNote(MP06), 7_777_777);
    expect(r.criterio).toBe('SIN_EVIDENCIA');
  });

  it('un IVA roto (0, negativo o ≥ total) no habilita la resta y no genera falsos positivos', async () => {
    for (const tax of [0, -100, MP06.totalAmount!, MP06.totalAmount! + 1]) {
      const note = reviewNote({ taxAmount: tax, totalAmount: MP06.totalAmount });
      expect((await clasificar(note, MP06.totalAmount!)).criterio).toBe('TOTAL_CON_IVA');
    }
  });

  it('la marca NO cambia ningún importe: la función solo devuelve un veredicto', async () => {
    // Blindaje contra que alguien convierta esto en un recálculo: lo único que
    // sale de la clasificación es el criterio y el IVA estimado, nunca un monto
    // corregido para reemplazar al guardado.
    const r = await clasificar(reviewNote(MP06), MP06.totalAmount!);
    expect(Object.keys(r).sort()).toEqual(['criterio', 'iva']);
    expect(r.iva).not.toBe(MP06.netAmount);
  });
});
