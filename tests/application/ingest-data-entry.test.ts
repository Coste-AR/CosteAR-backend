import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regresión del bug de ingesta: durante un tiempo solo el portal del operador
 * clasificaba. `/datos/submit` (API key) y el webhook de WhatsApp creaban la
 * DataEntry a mano, sin ClassificationAudit — y sin audit el documento llega al
 * costista "sin clasificar", la aprobación masiva lo saltea, y al aprobarlo no
 * genera línea del libro mayor ni pobla la estructura de costos.
 *
 * Estos tests fijan la invariante: TODA entrada que se persiste tiene su audit.
 */

const { mockTx, mockDb, mockClassify } = vi.hoisted(() => {
  const tx = {
    classificationAudit: { create: vi.fn() },
    processedCAE: { create: vi.fn() },
  };
  return {
    mockTx: tx,
    mockDb: {
      company: { findUnique: vi.fn() },
      processedCAE: { findUnique: vi.fn() },
      dataEntry: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
    mockClassify: vi.fn(),
  };
});

vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));
vi.mock('@/infrastructure/classifier/cascade-classifier.js', () => ({
  classifyDocument: mockClassify,
}));

const fakeGroq = { analyzeDocument: vi.fn() };

function classificationResult(overrides: Record<string, unknown> = {}) {
  return {
    documentType: 'FACTURA_COMPRA',
    costSection: 'MATERIA_PRIMA',
    confidence: 88,
    requiresReview: false,
    isDuplicate: false,
    qualityGate: 'PASS',
    definitiveSignal: 'CAE',
    signals: [],
    aiUsed: false,
    supplierFingerprintUsed: false,
    confidenceCap: null,
    intent: 'DOCUMENTO_FORMAL',
    industryCategory: 'GASTRONOMIA',
    explanation: 'Señal definitiva: CAE. Confianza: 88%.',
    ...overrides,
  };
}

const baseInput = {
  connectionId: 'conn-1',
  costistId: 'user-1',
  companyId: 'company-1',
  rawContent: 'Compré 10 kg de harina a $5000',
  sourceType: 'WHATSAPP' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.company.findUnique.mockResolvedValue({ industry: 'panadería', description: null });
  mockDb.processedCAE.findUnique.mockResolvedValue(null);
  mockDb.dataEntry.findFirst.mockResolvedValue(null);
  mockDb.dataEntry.findUnique.mockResolvedValue({ status: 'PENDING' });
  mockDb.dataEntry.create.mockResolvedValue({ id: 'entry-1', status: 'PENDING' });
  mockDb.$transaction.mockImplementation(async (fn: (t: typeof mockTx) => unknown) => fn(mockTx));
  fakeGroq.analyzeDocument.mockResolvedValue(null);
  mockClassify.mockResolvedValue(classificationResult());
});

describe('ingestDataEntry', () => {
  it('persiste el ClassificationAudit junto con la DataEntry', async () => {
    const { ingestDataEntry } = await import('@/application/ingest/ingest-data-entry.js');

    const res = await ingestDataEntry(baseInput, { db: mockDb as never, groq: fakeGroq as never });

    expect(res.isDuplicate).toBe(false);
    expect(res.id).toBe('entry-1');
    expect(mockDb.dataEntry.create).toHaveBeenCalledOnce();
    expect(mockTx.classificationAudit.create).toHaveBeenCalledOnce();

    const audit = mockTx.classificationAudit.create.mock.calls[0]![0].data;
    expect(audit.dataEntryId).toBe('entry-1');
    expect(audit.documentType).toBe('FACTURA_COMPRA');
    expect(audit.costSection).toBe('MATERIA_PRIMA');
    expect(audit.requiresReview).toBe(false);
  });

  it('clasifica un mensaje de WhatsApp como texto (el clasificador no conoce ese sourceType)', async () => {
    const { ingestDataEntry } = await import('@/application/ingest/ingest-data-entry.js');

    await ingestDataEntry(baseInput, { db: mockDb as never, groq: fakeGroq as never });

    expect(mockClassify.mock.calls[0]![0].sourceType).toBe('TEXT');
    // La entrada persistida sí conserva el canal real.
    expect(mockDb.dataEntry.create.mock.calls[0]![0].data.sourceType).toBe('WHATSAPP');
  });

  it('con rejectIllegible=false guarda la entrada ilegible en vez de perderla', async () => {
    const { ingestDataEntry } = await import('@/application/ingest/ingest-data-entry.js');
    mockClassify.mockResolvedValue(
      classificationResult({
        qualityGate: 'FAIL',
        documentType: 'DESCONOCIDO',
        costSection: 'DESCONOCIDO',
        confidence: 0,
        requiresReview: true,
      }),
    );

    const res = await ingestDataEntry(
      { ...baseInput, rejectIllegible: false },
      { db: mockDb as never, groq: fakeGroq as never },
    );

    expect(res.id).toBe('entry-1');
    expect(mockTx.classificationAudit.create).toHaveBeenCalledOnce();
    expect(mockTx.classificationAudit.create.mock.calls[0]![0].data.requiresReview).toBe(true);
  });

  it('con rejectIllegible=true rechaza el documento ilegible sin crear la entrada', async () => {
    const { ingestDataEntry } = await import('@/application/ingest/ingest-data-entry.js');
    mockClassify.mockResolvedValue(classificationResult({ qualityGate: 'FAIL' }));

    await expect(
      ingestDataEntry({ ...baseInput, rejectIllegible: true }, { db: mockDb as never, groq: fakeGroq as never }),
    ).rejects.toThrow();

    expect(mockDb.dataEntry.create).not.toHaveBeenCalled();
    expect(mockTx.classificationAudit.create).not.toHaveBeenCalled();
  });

  it('corta por duplicado de CAE sin crear entrada ni audit', async () => {
    const { ingestDataEntry } = await import('@/application/ingest/ingest-data-entry.js');
    mockDb.processedCAE.findUnique.mockResolvedValue({ dataEntryId: 'entry-previa' });
    mockDb.dataEntry.findUnique.mockResolvedValue({ status: 'APPROVED' });

    const res = await ingestDataEntry(
      { ...baseInput, rawContent: 'Factura con CAE 71234567890123 vto 30/09/2025' },
      { db: mockDb as never, groq: fakeGroq as never },
    );

    expect(res.isDuplicate).toBe(true);
    expect(res.duplicateEntryId).toBe('entry-previa');
    // El estado real de la entrada previa, no uno asumido: quien reenvía el
    // comprobante necesita saber si ya fue aprobado.
    expect(res.duplicateStatus).toBe('APPROVED');
    expect(mockDb.dataEntry.create).not.toHaveBeenCalled();
    expect(mockClassify).not.toHaveBeenCalled();
  });
});
