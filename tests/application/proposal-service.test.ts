import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, UnprocessableEntityError } from '@/domain/errors/domain-error.js';

/**
 * Tests de ProposalService (issue #99, B-11).
 *
 * Cubre:
 *   - listPending: devuelve propuestas en estado PENDING
 *   - approveProposal: NotFoundError si no existe, UnprocessableEntityError
 *     si ya fue procesada, y la validación de path traversal (crítica de
 *     seguridad: sourceFile generado por IA no debe poder escapar de la bóveda)
 *   - updateProposal: solo sobre PENDING, pone requiresVerification=false
 *   - rejectProposal: pone status='REJECTED'
 *
 * La escritura al filesystem y el commit git de approveProposal se mockean
 * porque el vault no existe en el entorno de test. El flujo "happy path" de
 * approveProposal depende de eso; acá se prueban solo las guardas de negocio.
 */

const mockPrisma = {
  vaultEditProposal: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockPrisma,
}));

// El indexador automático no debe correr en tests
vi.mock('@/application/vault-indexer/vault-indexer-service.js', () => ({
  VaultIndexerService: vi.fn(() => ({ indexVault: vi.fn().mockResolvedValue({ chunksUpserted: 0 }) })),
}));

// fs.appendFile mockeado para el happy path de approveProposal
vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
}));

// execFile mockeado (git commit en la bóveda)
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn((_cmd, _args, _opts, cb) => cb?.(null, '', '')) };
});

const pendingProposal = {
  id: 'prop-1',
  title: 'Agregar sección de IVA',
  status: 'PENDING',
  sourceFile: 'costos/iva.md',
  proposedText: 'El IVA se calcula sobre el precio neto.',
  requiresVerification: true,
};

describe('ProposalService', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── listPending ──────────────────────────────────────────────────────────

  it('listPending: devuelve las propuestas pendientes ordenadas por createdAt desc', async () => {
    const { ProposalService } = await import('@/application/nightly-learning/proposal-service.js');
    const svc = new ProposalService();

    const proposals = [pendingProposal, { ...pendingProposal, id: 'prop-2' }];
    mockPrisma.vaultEditProposal.findMany.mockResolvedValue(proposals);

    const result = await svc.listPending();

    expect(result).toHaveLength(2);
    expect(mockPrisma.vaultEditProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PENDING' } }),
    );
  });

  // ── approveProposal — guardas de negocio ────────────────────────────────

  it('approveProposal: lanza NotFoundError si la propuesta no existe', async () => {
    const { ProposalService } = await import('@/application/nightly-learning/proposal-service.js');
    const svc = new ProposalService();

    mockPrisma.vaultEditProposal.findUnique.mockResolvedValue(null);

    await expect(svc.approveProposal('u-1', 'prop-x')).rejects.toThrow(NotFoundError);
  });

  it('approveProposal: lanza UnprocessableEntityError si ya fue procesada', async () => {
    const { ProposalService } = await import('@/application/nightly-learning/proposal-service.js');
    const svc = new ProposalService();

    mockPrisma.vaultEditProposal.findUnique.mockResolvedValue({
      ...pendingProposal,
      status: 'PROCESSED',
    });

    await expect(svc.approveProposal('u-1', 'prop-1')).rejects.toThrow(UnprocessableEntityError);
  });

  // ── path traversal (seguridad crítica) ──────────────────────────────────

  it('approveProposal: rechaza sourceFile que escapa de la bóveda (path traversal)', async () => {
    const { ProposalService } = await import('@/application/nightly-learning/proposal-service.js');
    const svc = new ProposalService();

    mockPrisma.vaultEditProposal.findUnique.mockResolvedValue({
      ...pendingProposal,
      sourceFile: '../../../.env', // intento de path traversal
    });

    await expect(svc.approveProposal('u-1', 'prop-1')).rejects.toThrow(UnprocessableEntityError);
    await expect(svc.approveProposal('u-1', 'prop-1')).rejects.toThrow(/fuera de la bóveda/);
  });

  it('approveProposal: rechaza sourceFile con double-dot en el medio', async () => {
    const { ProposalService } = await import('@/application/nightly-learning/proposal-service.js');
    const svc = new ProposalService();

    mockPrisma.vaultEditProposal.findUnique.mockResolvedValue({
      ...pendingProposal,
      sourceFile: 'costos/../../etc/passwd',
    });

    await expect(svc.approveProposal('u-1', 'prop-1')).rejects.toThrow(UnprocessableEntityError);
  });

  // ── updateProposal ───────────────────────────────────────────────────────

  it('updateProposal: lanza NotFoundError si la propuesta no existe', async () => {
    const { ProposalService } = await import('@/application/nightly-learning/proposal-service.js');
    const svc = new ProposalService();

    mockPrisma.vaultEditProposal.findUnique.mockResolvedValue(null);

    await expect(svc.updateProposal('prop-x', { title: 'nuevo título' })).rejects.toThrow(NotFoundError);
  });

  it('updateProposal: lanza UnprocessableEntityError si la propuesta ya fue procesada', async () => {
    const { ProposalService } = await import('@/application/nightly-learning/proposal-service.js');
    const svc = new ProposalService();

    mockPrisma.vaultEditProposal.findUnique.mockResolvedValue({
      ...pendingProposal,
      status: 'REJECTED',
    });

    await expect(svc.updateProposal('prop-1', { title: 'nuevo' })).rejects.toThrow(UnprocessableEntityError);
  });

  it('updateProposal: pone requiresVerification=false (un admin editó el contenido)', async () => {
    const { ProposalService } = await import('@/application/nightly-learning/proposal-service.js');
    const svc = new ProposalService();

    mockPrisma.vaultEditProposal.findUnique.mockResolvedValue(pendingProposal);
    mockPrisma.vaultEditProposal.update.mockResolvedValue({
      ...pendingProposal,
      title: 'Título actualizado',
      requiresVerification: false,
    });

    await svc.updateProposal('prop-1', { title: 'Título actualizado' });

    expect(mockPrisma.vaultEditProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requiresVerification: false }),
      }),
    );
  });

  // ── rejectProposal ───────────────────────────────────────────────────────

  it('rejectProposal: pone status=REJECTED con reviewedBy y reviewedAt', async () => {
    const { ProposalService } = await import('@/application/nightly-learning/proposal-service.js');
    const svc = new ProposalService();

    mockPrisma.vaultEditProposal.findUnique.mockResolvedValue(pendingProposal);
    mockPrisma.vaultEditProposal.update.mockResolvedValue({
      ...pendingProposal,
      status: 'REJECTED',
      reviewedBy: 'u-1',
      reviewedAt: new Date(),
    });

    await svc.rejectProposal('u-1', 'prop-1');

    expect(mockPrisma.vaultEditProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED', reviewedBy: 'u-1' }),
      }),
    );
  });

  it('rejectProposal: lanza NotFoundError si la propuesta no existe', async () => {
    const { ProposalService } = await import('@/application/nightly-learning/proposal-service.js');
    const svc = new ProposalService();

    mockPrisma.vaultEditProposal.findUnique.mockResolvedValue(null);

    await expect(svc.rejectProposal('u-1', 'prop-x')).rejects.toThrow(NotFoundError);
  });
});
