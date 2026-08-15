import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * EvidenceService (T-04) — las reglas que no pueden romperse nunca.
 *
 *   R1 — adjuntar un comprobante NO pisa la versión vigente: crea version_n+1.
 *        (Además de que el trigger `data_point_versions_append_only` rechaza
 *        cualquier UPDATE; acá se verifica que ni siquiera se intenta.)
 *   R2 — el alta y el adjunto escriben su auditoría en la MISMA transacción.
 *
 * Y la decisión de producto que sostiene la mitad de la funcionalidad: sin
 * almacenamiento de archivos configurado, el comprobante se registra IGUAL como
 * referencia. El día que Cloudinary no esté, el costista tiene que poder seguir
 * dejando asentado "esto sale de la factura A 0001-00012345 de Proveedor SA".
 *
 * Prisma va mockeado (mismo patrón que data-point-service.test.ts). La prueba
 * contra Postgres real —versión nueva de verdad, v1 todavía legible, el trigger
 * rechazando un UPDATE— vive en tests/security/evidence-append-only.test.ts.
 */

const mockTx = {
  evidence: { create: vi.fn(), findFirst: vi.fn() },
  dataPoint: { findFirst: vi.fn(), update: vi.fn() },
  dataPointVersion: { create: vi.fn(), findFirst: vi.fn() },
  traceAuditLog: { create: vi.fn() },
  costStructure: { findFirst: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockTx,
  withTenant: (_userId: string, fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
}));

const uploadToCloudinary = vi.fn();
vi.mock('@/infrastructure/cloudinary/cloudinary-upload.js', () => ({
  uploadToCloudinary: (...args: unknown[]) => uploadToCloudinary(...args),
}));

const actor = { id: 'user-1', role: 'COSTISTA', area: 'costista', device: 'test-agent · 127.0.0.1' };

const EV = {
  id: 'ev-1',
  kind: 'factura',
  reference: 'A 0001-00012345',
  counterparty: 'Proveedor SA',
  fileUrl: null as string | null,
  uploadedAt: new Date('2026-08-12T10:00:00Z'),
};

async function nuevoServicio() {
  const { EvidenceService } = await import('@/application/trazabilidad/evidence-service.js');
  return new EvidenceService(mockTx as never);
}

describe('EvidenceService — alta del comprobante', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.evidence.create.mockResolvedValue(EV);
  });

  it('sin archivo: registra el comprobante como referencia (fileUrl NULL) y ni toca el storage', async () => {
    const service = await nuevoServicio();

    const ev = await service.create(
      'user-1',
      { kind: 'factura', reference: 'A 0001-00012345', counterparty: 'Proveedor SA' },
      actor,
    );

    expect(uploadToCloudinary).not.toHaveBeenCalled();
    expect(ev.fileUrl).toBeNull();
    expect(ev.archivo).toBe('sin-archivo');
    expect(ev.aviso).toBeNull();
    // El dueño es el costista que lo subió: es lo que después filtra la política
    // RLS de la tabla.
    expect(mockTx.evidence.create.mock.calls[0]![0].data.uploadedBy).toBe('user-1');
  });

  it('con archivo y storage caído: guarda igual el comprobante y lo DICE (no lo esconde)', async () => {
    uploadToCloudinary.mockRejectedValue(new Error('Cloudinary no está configurado'));
    const service = await nuevoServicio();

    const ev = await service.create(
      'user-1',
      {
        kind: 'remito',
        reference: 'R 0001-0009',
        file: { data: 'YmFzZTY0', mimeType: 'application/pdf', fileName: 'remito.pdf' },
      },
      actor,
    );

    // Lo que NO puede pasar: que el alta se pierda porque no hay storage.
    expect(mockTx.evidence.create).toHaveBeenCalledTimes(1);
    expect(mockTx.evidence.create.mock.calls[0]![0].data.fileUrl).toBeNull();
    expect(ev.archivo).toBe('no-se-pudo-guardar');
    expect(ev.aviso).toMatch(/no se pudo guardar/i);
  });

  it('con archivo y storage andando: guarda la URL', async () => {
    uploadToCloudinary.mockResolvedValue('https://res.cloudinary.com/x/comprobante.pdf');
    mockTx.evidence.create.mockResolvedValue({
      ...EV,
      fileUrl: 'https://res.cloudinary.com/x/comprobante.pdf',
    });
    const service = await nuevoServicio();

    const ev = await service.create(
      'user-1',
      {
        kind: 'factura',
        reference: 'A 0001-00012345',
        file: { data: 'YmFzZTY0', mimeType: 'application/pdf', fileName: 'factura.pdf' },
      },
      actor,
    );

    expect(uploadToCloudinary).toHaveBeenCalledWith(
      'YmFzZTY0',
      'application/pdf',
      'factura.pdf',
      'costear/comprobantes',
    );
    expect(ev.fileUrl).toBe('https://res.cloudinary.com/x/comprobante.pdf');
    expect(ev.archivo).toBe('guardado');
  });

  it('el alta queda auditada en la misma transacción (R2)', async () => {
    const service = await nuevoServicio();
    await service.create('user-1', { kind: 'acta', reference: 'Acta 12/2026' }, actor);

    expect(mockTx.traceAuditLog.create).toHaveBeenCalledTimes(1);
    const entry = mockTx.traceAuditLog.create.mock.calls[0]![0].data;
    expect(entry.entityType).toBe('Evidence');
    expect(entry.action).toBe('crear');
    expect(entry.actorId).toBe('user-1');
  });
});

describe('EvidenceService — adjuntar a un dato', () => {
  const attach = { evidenceId: 'ev-1', reason: 'Llegó la factura del proveedor', sourceArea: 'costista' as const };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.dataPoint.findFirst.mockResolvedValue({
      id: 'dp-1',
      structureId: 'st-1',
      status: 'validado',
      voidedAt: null,
      fechaHecho: null,
      structure: { userId: 'user-1' },
    });
    mockTx.evidence.findFirst.mockResolvedValue(EV);
    mockTx.dataPointVersion.findFirst.mockResolvedValue({
      id: 'v1',
      versionN: 1,
      valueNum: 1500,
      valueJson: null,
      evidenceId: null,
      method: 'excel_import',
    });
    mockTx.dataPointVersion.create.mockResolvedValue({ id: 'v2', versionN: 2 });
  });

  it('crea una VERSIÓN NUEVA con el comprobante — nunca actualiza la vigente (R1)', async () => {
    const service = await nuevoServicio();
    const res = await service.attach('user-1', 'dp-1', attach, actor);

    expect(mockTx.dataPointVersion.create).toHaveBeenCalledTimes(1);
    const data = mockTx.dataPointVersion.create.mock.calls[0]![0].data;
    expect(data.versionN).toBe(2);
    expect(data.evidenceId).toBe('ev-1');
    expect(data.reason).toBe('Llegó la factura del proveedor');
    expect(res.versionN).toBe(2);
    // No existe ninguna vía de UPDATE sobre una versión: la inmutabilidad no
    // depende de que el trigger la ataje.
    expect(mockTx.dataPointVersion).not.toHaveProperty('update');
  });

  it('no cambia el valor ni el método de captura: adjuntar un papel no recalcula nada', async () => {
    const service = await nuevoServicio();
    await service.attach('user-1', 'dp-1', attach, actor);

    const data = mockTx.dataPointVersion.create.mock.calls[0]![0].data;
    expect(data.valueNum).toBe(1500);
    // El método describe cómo entró EL VALOR; pisarlo con 'manual' reescribiría
    // el origen del número.
    expect(data.method).toBe('excel_import');
  });

  it('no vuelve el dato a borrador: un dato validado sigue validado', async () => {
    const service = await nuevoServicio();
    await service.attach('user-1', 'dp-1', attach, actor);

    // Degradar a borrador castigaría al que MEJORA el respaldo de un dato que
    // alguien ya firmó.
    expect(mockTx.dataPoint.update).not.toHaveBeenCalled();
  });

  it('queda auditado como adjuntar_comprobante en la misma transacción (R2)', async () => {
    const service = await nuevoServicio();
    await service.attach('user-1', 'dp-1', attach, actor);

    const entry = mockTx.traceAuditLog.create.mock.calls[0]![0].data;
    expect(entry.entityType).toBe('DataPoint');
    expect(entry.entityId).toBe('dp-1');
    expect(entry.action).toBe('adjuntar_comprobante');
    expect(entry.comment).toBe('Llegó la factura del proveedor');
  });

  it('adjuntar dos veces el mismo comprobante no genera una versión de más', async () => {
    mockTx.dataPointVersion.findFirst.mockResolvedValue({
      id: 'v2',
      versionN: 2,
      valueNum: 1500,
      valueJson: null,
      evidenceId: 'ev-1',
      method: 'manual',
    });
    const service = await nuevoServicio();
    const res = await service.attach('user-1', 'dp-1', attach, actor);

    expect(res.yaEstaba).toBe(true);
    expect(mockTx.dataPointVersion.create).not.toHaveBeenCalled();
    expect(mockTx.traceAuditLog.create).not.toHaveBeenCalled();
  });

  it('no se puede adjuntar un comprobante de OTRO costista', async () => {
    // El filtro es `uploadedBy = userId`: si el comprobante no es suyo, para
    // este usuario no existe.
    mockTx.evidence.findFirst.mockResolvedValue(null);
    const service = await nuevoServicio();

    await expect(service.attach('user-1', 'dp-1', attach, actor)).rejects.toThrow(
      /Comprobante no encontrado/,
    );
    expect(mockTx.dataPointVersion.create).not.toHaveBeenCalled();
  });

  it('no se puede adjuntar a un dato anulado', async () => {
    mockTx.dataPoint.findFirst.mockResolvedValue({
      id: 'dp-1',
      structureId: 'st-1',
      status: 'anulado',
      voidedAt: new Date(),
      fechaHecho: null,
      structure: { userId: 'user-1' },
    });
    const service = await nuevoServicio();

    await expect(service.attach('user-1', 'dp-1', attach, actor)).rejects.toThrow(/anulado/);
  });

  it('un dato de otro costista no existe para este usuario', async () => {
    mockTx.dataPoint.findFirst.mockResolvedValue(null);
    const service = await nuevoServicio();

    await expect(service.attach('user-1', 'dp-ajeno', attach, actor)).rejects.toThrow(
      /Dato no encontrado/,
    );
  });
});
