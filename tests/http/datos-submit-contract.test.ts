import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Test de CONTRATO de `POST /datos/submit`.
 *
 * Es superficie pública: la consumen integraciones de clientes que viven fuera
 * de estos repos y que no podemos desplegar. Estos tests existen para que un
 * cambio de forma en la respuesta falle acá y no en la integración de alguien.
 *
 * Invariante: `id`, `status` e `isDuplicate` están SIEMPRE presentes en las dos
 * respuestas de éxito. Ver docs/api-ingesta.md.
 */

const { submitDataViaApiKey } = vi.hoisted(() => ({ submitDataViaApiKey: vi.fn() }));

vi.mock('@/application/empresa/empresa-connection-service.js', () => ({
  EmpresaConnectionService: class {
    submitDataViaApiKey = submitDataViaApiKey;
    listConnections = vi.fn();
    createConnection = vi.fn();
    rotateApiKey = vi.fn();
    deleteConnection = vi.fn();
    setWhatsappNumber = vi.fn();
  },
}));
vi.mock('@/application/validaciones/validaciones-service.js', () => ({
  ValidacionesService: class {},
}));
vi.mock('@/application/validaciones/validaciones-ledger-service.js', () => ({
  ValidacionesLedgerService: class {},
}));

async function buildTestApp() {
  const Fastify = (await import('fastify')).default;
  const { registerValidacionesRoutes } = await import(
    '@/infrastructure/http/routes/validaciones.routes.js'
  );
  const app = Fastify({ logger: false });
  await app.register(registerValidacionesRoutes);
  await app.ready();
  return app;
}

const body = { rawContent: 'Factura A 0001-00012345 — Molinos SA — $150.000', sourceType: 'TEXT' };

beforeEach(() => vi.clearAllMocks());

describe('contrato de POST /datos/submit', () => {
  it('201 con id, status, isDuplicate:false y classification cuando crea', async () => {
    submitDataViaApiKey.mockResolvedValue({
      isDuplicate: false,
      id: 'entry-1',
      status: 'PENDING',
      classification: {
        documentType: 'FACTURA_COMPRA', costSection: 'MATERIA_PRIMA',
        confidence: 88, requiresReview: false, qualityGate: 'PASS',
      },
    });

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/datos/submit',
      headers: { 'x-api-key': 'k' }, payload: body,
    });

    expect(res.statusCode).toBe(201);
    const { data } = res.json();
    expect(data.id).toBe('entry-1');
    expect(data.status).toBe('PENDING');
    expect(data.isDuplicate).toBe(false);
    expect(data.classification.documentType).toBe('FACTURA_COMPRA');
    await app.close();
  });

  it('200 con isDuplicate:true y el id de la entrada YA existente', async () => {
    submitDataViaApiKey.mockResolvedValue({
      isDuplicate: true,
      duplicateEntryId: 'entry-previa',
      duplicateStatus: 'APPROVED',
      message: 'Este comprobante ya fue enviado antes (mismo proveedor y número).',
    });

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/datos/submit',
      headers: { 'x-api-key': 'k' }, payload: body,
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.isDuplicate).toBe(true);
    expect(data.id).toBe('entry-previa');
    // El estado REAL de la entrada previa, no uno asumido.
    expect(data.status).toBe('APPROVED');
    await app.close();
  });

  it('la forma del payload es la misma en los dos casos (id/status/isDuplicate siempre)', async () => {
    const app = await buildTestApp();

    submitDataViaApiKey.mockResolvedValue({ isDuplicate: false, id: 'a', status: 'PENDING', classification: {} });
    const nuevo = (await app.inject({ method: 'POST', url: '/datos/submit', headers: { 'x-api-key': 'k' }, payload: body })).json();

    submitDataViaApiKey.mockResolvedValue({ isDuplicate: true, duplicateEntryId: 'b', duplicateStatus: 'PENDING', message: 'ya estaba' });
    const dup = (await app.inject({ method: 'POST', url: '/datos/submit', headers: { 'x-api-key': 'k' }, payload: body })).json();

    for (const campo of ['id', 'status', 'isDuplicate']) {
      expect(nuevo.data[campo]).toBeDefined();
      expect(dup.data[campo]).toBeDefined();
    }
    await app.close();
  });

  it('401 sin x-api-key, sin llegar al servicio', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/datos/submit', payload: body });

    expect(res.statusCode).toBe(401);
    expect(submitDataViaApiKey).not.toHaveBeenCalled();
    await app.close();
  });

  it('sourceType default TEXT cuando no se manda', async () => {
    submitDataViaApiKey.mockResolvedValue({ isDuplicate: false, id: 'a', status: 'PENDING', classification: {} });

    const app = await buildTestApp();
    await app.inject({
      method: 'POST', url: '/datos/submit',
      headers: { 'x-api-key': 'k' }, payload: { rawContent: 'algo' },
    });

    expect(submitDataViaApiKey.mock.calls[0]![1].sourceType).toBe('TEXT');
    await app.close();
  });
});
