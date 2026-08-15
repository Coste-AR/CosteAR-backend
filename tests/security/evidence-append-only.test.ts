import { describe, it, expect, beforeAll, afterAll, type TestContext } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * T-04 — El camino completo del comprobante, contra Postgres de verdad y por la
 * API de verdad (`app.inject`, las mismas rutas que usa el frontend).
 *
 * Los tests con Prisma mockeado (tests/application/evidence-service.test.ts)
 * prueban que el servicio NO LLAMA a un update. Este prueba lo otro, que es lo
 * que realmente importa cuando alguien audita:
 *
 *   · adjuntar un comprobante deja DOS filas en data_point_versions, no una
 *     pisada;
 *   · la v1 sigue ahí y sigue leyéndose, con su valor original y sin
 *     comprobante — el historial no se reescribió;
 *   · GET /data-points/:id/trace devuelve el bloque del comprobante;
 *   · y un UPDATE directo sobre data_point_versions —salteando la aplicación
 *     entera— lo sigue rechazando la base.
 *
 * Sin base no hay nada que verificar: se saltea (nunca da verde en falso).
 * Cómo correrlo:
 *
 *   docker start costear-postgres
 *   npx vitest run tests/security/evidence-append-only.test.ts
 */

if (!process.env.DATABASE_URL) {
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
process.env.NODE_ENV = 'test';

const DB_URL = process.env.DATABASE_URL;

/** ids fijos y reconocibles: si algo queda colgado, se ve de lejos en la base. */
const T = {
  user: 'e0000000-0000-4000-8000-000000000001',
  company: 'e0000000-0000-4000-8000-000000000002',
  structure: 'e0000000-0000-4000-8000-000000000003',
};

let db: PrismaClient | undefined;
let app: FastifyInstance | undefined;
let token = '';

/** ¿Se puede verificar algo en este entorno? Corre al COLECTAR, para skipIf. */
async function diagnosticar(): Promise<string | null> {
  if (!DB_URL) return 'no hay DATABASE_URL: sin base no hay comprobantes que verificar';
  db = new PrismaClient({ datasourceUrl: DB_URL });
  try {
    await db.$queryRawUnsafe('SELECT 1');
  } catch (err) {
    return `no se pudo conectar a la base: ${(err as Error).message.split('\n')[0]}`;
  }
  try {
    await db.$queryRawUnsafe('SELECT 1 FROM evidence LIMIT 1');
  } catch {
    return 'la tabla evidence no existe: falta correr las migraciones';
  }
  return null;
}

const motivoSkip = await diagnosticar();
const HAY_BASE = motivoSkip === null;

if (!HAY_BASE) {
  console.warn(`\n[T-04] Comprobantes NO verificados contra la base: ${motivoSkip}.\n`);
}

async function limpiar(): Promise<void> {
  // El trigger append-only prohíbe DELETE sobre data_point_versions — está para
  // eso. Se apaga SOLO dentro de esta transacción (SET LOCAL vuelve solo) y
  // sólo para borrar los datos de prueba.
  await db!.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
    await tx.$executeRawUnsafe(
      `DELETE FROM data_point_versions WHERE "dataPointId" IN (SELECT id FROM data_points WHERE "structureId" = '${T.structure}')`,
    );
    await tx.$executeRawUnsafe(`DELETE FROM data_points WHERE "structureId" = '${T.structure}'`);
    await tx.$executeRawUnsafe(`DELETE FROM evidence WHERE "uploadedBy" = '${T.user}'`);
    await tx.$executeRawUnsafe(`DELETE FROM trace_audit_log WHERE "actorId" = '${T.user}'`);
    await tx.$executeRawUnsafe(`DELETE FROM cost_structures WHERE id = '${T.structure}'`);
    await tx.$executeRawUnsafe(`DELETE FROM companies WHERE id = '${T.company}'`);
    await tx.$executeRawUnsafe(`DELETE FROM users WHERE id = '${T.user}'`);
  });
}

async function sembrar(): Promise<void> {
  const stmts = [
    `INSERT INTO users (id, email, "passwordHash", name, role, "updatedAt")
       VALUES ('${T.user}', 'evidence-probe@costear.test', 'x', 'Costista Probe', 'COSTISTA', now())`,
    `INSERT INTO companies (id, "userId", name, "updatedAt")
       VALUES ('${T.company}', '${T.user}', 'Empresa Probe', now())`,
    `INSERT INTO cost_structures (id, "companyId", "userId", "productName", period, "updatedAt")
       VALUES ('${T.structure}', '${T.company}', '${T.user}', 'Producto Probe', '2026-08', now())`,
  ];
  for (const s of stmts) await db!.$executeRawUnsafe(s);
}

interface RespuestaApi<T> {
  data: T;
}

async function post<T>(url: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await app!.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: body as Record<string, unknown>,
  });
  return { status: res.statusCode, data: (res.json() as RespuestaApi<T>).data };
}

async function get<T>(url: string): Promise<{ status: number; data: T }> {
  const res = await app!.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: res.statusCode, data: (res.json() as RespuestaApi<T>).data };
}

describe('T-04: ¿este entorno puede verificar los comprobantes?', () => {
  it('hay una base con el esquema de trazabilidad', (ctx: TestContext) => {
    if (!HAY_BASE) {
      ctx.skip();
      return;
    }
    expect(motivoSkip).toBeNull();
  });
});

describe.skipIf(!HAY_BASE)('T-04: adjuntar un comprobante a un dato ya cargado', () => {
  let dataPointId = '';
  let evidenceId = '';

  beforeAll(async () => {
    await limpiar();
    await sembrar();

    // Se monta SOLO el módulo de rutas de trazabilidad sobre un Fastify pelado,
    // con el mismo prefijo y el mismo error handler que la app real. No se usa
    // `buildApp()` porque arrastra Sentry con su binding nativo de profiling,
    // que tumba al worker de vitest: para lo que se prueba acá —el contrato
    // HTTP de estas rutas— CORS, helmet y el rate limit no aportan nada.
    const Fastify = (await import('fastify')).default;
    const { registerTrazabilidadRoutes } = await import(
      '@/infrastructure/http/routes/trazabilidad.routes.js'
    );
    const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
    const { signAccessToken } = await import('@/infrastructure/crypto/tokens.js');

    app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(async (api) => { await registerTrazabilidadRoutes(api); }, { prefix: '/api/v1' });
    await app.ready();
    token = signAccessToken({ sub: T.user, tenantId: T.user, role: 'COSTISTA' });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (HAY_BASE) await limpiar();
    await db?.$disconnect();
  });

  it('1. se carga un dato a mano: nace con versión 1 y sin comprobante', async () => {
    const res = await post<{ id: string }>(`/api/v1/structures/${T.structure}/data-points`, {
      element: 'CIP',
      fieldKey: 'cip.concepto.importe',
      label: 'Energía eléctrica — planta',
      unit: '$',
      sourceArea: 'contaduria',
      method: 'manual',
      valueNum: 184500.5,
    });
    expect(res.status).toBe(201);
    dataPointId = res.data.id;

    const trace = await get<{ evidence: unknown; versions: { n: number }[] }>(
      `/api/v1/data-points/${dataPointId}/trace`,
    );
    expect(trace.status).toBe(200);
    expect(trace.data.evidence).toBeNull();
    expect(trace.data.versions).toHaveLength(1);
  });

  it('2. se da de alta el comprobante SIN archivo: queda como referencia (fileUrl NULL)', async () => {
    const res = await post<{ id: string; fileUrl: string | null; archivo: string }>(
      '/api/v1/evidence',
      {
        kind: 'factura',
        reference: 'A 0001-00012345',
        counterparty: 'Energía del Norte SA',
      },
    );
    expect(res.status).toBe(201);
    evidenceId = res.data.id;

    // La promesa del manual: "NULL si es referencia sin archivo". El alta no
    // depende de que haya almacenamiento configurado.
    expect(res.data.fileUrl).toBeNull();
    expect(res.data.archivo).toBe('sin-archivo');

    const fila = await db!.$queryRawUnsafe<{ uploadedBy: string }[]>(
      `SELECT "uploadedBy" FROM evidence WHERE id = '${evidenceId}'`,
    );
    expect(fila[0]!.uploadedBy).toBe(T.user);
  });

  it('3. adjuntarlo crea una VERSIÓN NUEVA — la v1 sigue entera y legible (R1)', async () => {
    const res = await post<{ versionN: number; yaEstaba: boolean }>(
      `/api/v1/data-points/${dataPointId}/evidence`,
      { evidenceId, reason: 'Llegó la factura del proveedor' },
    );
    expect(res.status).toBe(201);
    expect(res.data.versionN).toBe(2);
    expect(res.data.yaEstaba).toBe(false);

    const versiones = await db!.$queryRawUnsafe<
      { versionN: number; valueNum: string; evidenceId: string | null; reason: string | null }[]
    >(
      `SELECT "versionN", "valueNum"::text AS "valueNum", "evidenceId", reason
         FROM data_point_versions WHERE "dataPointId" = '${dataPointId}' ORDER BY "versionN"`,
    );

    expect(versiones).toHaveLength(2);

    // La v1 quedó EXACTAMENTE como estaba: nadie le metió el comprobante
    // adentro ni le cambió el valor.
    expect(versiones[0]!.versionN).toBe(1);
    expect(versiones[0]!.evidenceId).toBeNull();
    expect(Number(versiones[0]!.valueNum)).toBe(184500.5);

    // La v2 lleva el comprobante y el mismo valor: adjuntar un papel no puede
    // mover un número.
    expect(versiones[1]!.versionN).toBe(2);
    expect(versiones[1]!.evidenceId).toBe(evidenceId);
    expect(Number(versiones[1]!.valueNum)).toBe(184500.5);
    expect(versiones[1]!.reason).toBe('Llegó la factura del proveedor');
  });

  it('4. la ficha del dato ya muestra el comprobante (GET /trace)', async () => {
    const trace = await get<{
      evidence: { kind: string; reference: string; counterparty: string | null; fileUrl: string | null } | null;
      versions: { n: number; current: boolean }[];
    }>(`/api/v1/data-points/${dataPointId}/trace`);

    expect(trace.status).toBe(200);
    expect(trace.data.evidence).toEqual({
      kind: 'factura',
      reference: 'A 0001-00012345',
      counterparty: 'Energía del Norte SA',
      fileUrl: null,
    });
    // Las dos versiones siguen en el historial; la vigente es la v2.
    expect(trace.data.versions.map((v) => v.n)).toEqual([2, 1]);
    expect(trace.data.versions.find((v) => v.current)!.n).toBe(2);
  });

  it('5. quedó auditado en trace_audit_log (R2)', async () => {
    const filas = await db!.$queryRawUnsafe<{ action: string; entityType: string }[]>(
      `SELECT action, "entityType" FROM trace_audit_log WHERE "actorId" = '${T.user}' ORDER BY id`,
    );
    const acciones = filas.map((f) => `${f.entityType}.${f.action}`);
    expect(acciones).toContain('DataPoint.crear');
    expect(acciones).toContain('Evidence.crear');
    expect(acciones).toContain('DataPoint.adjuntar_comprobante');
  });

  it('6. adjuntar el MISMO comprobante otra vez no agrega una versión de más', async () => {
    const res = await post<{ versionN: number; yaEstaba: boolean }>(
      `/api/v1/data-points/${dataPointId}/evidence`,
      { evidenceId, reason: 'Reintento del mismo adjunto' },
    );
    expect(res.data.yaEstaba).toBe(true);

    const n = await db!.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM data_point_versions WHERE "dataPointId" = '${dataPointId}'`,
    );
    expect(n[0]!.n).toBe(2);
  });

  it('7. un comprobante de OTRO costista no se puede adjuntar', async () => {
    const ajeno = 'e0000000-0000-4000-8000-0000000000ff';
    await db!.$executeRawUnsafe(
      `INSERT INTO evidence (id, kind, reference, "uploadedBy") VALUES ('${ajeno}', 'factura', 'B 0002-000001', NULL)`,
    );
    const res = await app!.inject({
      method: 'POST',
      url: `/api/v1/data-points/${dataPointId}/evidence`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { evidenceId: ajeno, reason: 'no debería entrar' },
    });
    expect(res.statusCode).toBe(404);
    await db!.$executeRawUnsafe(`DELETE FROM evidence WHERE id = '${ajeno}'`);
  });

  it('8. la BASE sigue rechazando un UPDATE directo sobre una versión', async () => {
    // La garantía de fondo: aunque alguien se saltee la aplicación entera y
    // escriba SQL a mano, la versión vigente no se puede reescribir.
    await expect(
      db!.$executeRawUnsafe(
        `UPDATE data_point_versions SET "evidenceId" = NULL WHERE "dataPointId" = '${dataPointId}' AND "versionN" = 2`,
      ),
    ).rejects.toThrow();

    // Y el DELETE tampoco: el historial no se poda.
    await expect(
      db!.$executeRawUnsafe(
        `DELETE FROM data_point_versions WHERE "dataPointId" = '${dataPointId}' AND "versionN" = 1`,
      ),
    ).rejects.toThrow();
  });
});
