import { describe, it, expect, vi, beforeEach } from 'vitest';

// CostitaChatService instancia GroqCostitaChat como default de constructor, y su
// constructor valida el entorno (getEnv()) aunque en los tests inyectemos un mock —
// la instanciación del default ocurre igual al importar el módulo. DATABASE_URL es
// la única variable sin default en el schema de env, así que la seteamos acá como
// hacen otros tests (ver tests/auth/refresh-rotation.test.ts).
process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';

const mockDb = {
  dailySignal: { create: vi.fn() },
  company: { findMany: vi.fn(), findFirst: vi.fn() },
  dataEntry: { count: vi.fn(), create: vi.fn() },
  alert: { count: vi.fn(), create: vi.fn() },
  macroSnapshot: { findMany: vi.fn() },
  empresaConnection: { findFirst: vi.fn(), create: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));

const mockChat = { isConfigured: true, interpret: vi.fn() };
const mockVaultQuery = { query: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.company.findMany.mockResolvedValue([]);
  mockDb.dataEntry.count.mockResolvedValue(0);
  mockDb.alert.count.mockResolvedValue(0);
  mockDb.macroSnapshot.findMany.mockResolvedValue([]);
  mockChat.isConfigured = true;
});

describe('CostitaChatService.interpret — ruteo VAULT_QUESTION al RAG', () => {
  it('cuando el chat devuelve VAULT_QUESTION, consulta el RAG de la bóveda (no al LLM genérico de nuevo)', async () => {
    const { CostitaChatService } = await import('@/application/costista-chat/costista-chat-service.js');
    mockChat.interpret.mockResolvedValue({ reply: '', actionType: 'VAULT_QUESTION', confidence: 100 });
    mockVaultQuery.query.mockResolvedValue({
      answer: 'El ITCS es la Tasa Integral de Costo Social...',
      citations: ['Costeo/ITCS.md'],
      confidence: 'HIGH',
    });

    const svc = new CostitaChatService(mockDb as never, mockChat as never, mockVaultQuery as never);
    const res = await svc.interpret('user-1', { message: '¿Qué es el ITCS?' });

    expect(mockVaultQuery.query).toHaveBeenCalledWith('¿Qué es el ITCS?');
    expect(res.actionType).toBe('INFO_ONLY');
    expect(res.reply).toContain('El ITCS es la Tasa Integral de Costo Social');
    expect(res.reply).toContain('Costeo/ITCS.md');
    expect(res.confidence).toBe(90);
  });

  it('cuando el chat devuelve INFO_ONLY (pregunta de uso de la app), nunca llama al RAG de la bóveda', async () => {
    const { CostitaChatService } = await import('@/application/costista-chat/costista-chat-service.js');
    mockChat.interpret.mockResolvedValue({
      reply: 'Andá a la pestaña Clientes...',
      actionType: 'INFO_ONLY',
      confidence: 100,
    });

    const svc = new CostitaChatService(mockDb as never, mockChat as never, mockVaultQuery as never);
    const res = await svc.interpret('user-1', { message: '¿Cómo cargo una empresa?' });

    expect(mockVaultQuery.query).not.toHaveBeenCalled();
    expect(res.actionType).toBe('INFO_ONLY');
  });

  it('si el RAG de la bóveda falla, cae a un mensaje seguro y registra ASSISTANT_MISS', async () => {
    const { CostitaChatService } = await import('@/application/costista-chat/costista-chat-service.js');
    mockChat.interpret.mockResolvedValue({ reply: '', actionType: 'VAULT_QUESTION', confidence: 100 });
    mockVaultQuery.query.mockRejectedValue(new Error('IA no configurada'));

    const svc = new CostitaChatService(mockDb as never, mockChat as never, mockVaultQuery as never);
    const res = await svc.interpret('user-1', { message: '¿Qué es el ITCS?' });

    expect(res.actionType).toBe('INFO_ONLY');
    expect(res.confidence).toBe(0);
    expect(mockDb.dailySignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'ASSISTANT_MISS', source: 'COSTISTA_CHAT' }),
      }),
    );
  });

  it('confianza LOW del RAG se mapea a 50, NONE a 0', async () => {
    const { CostitaChatService } = await import('@/application/costista-chat/costista-chat-service.js');
    mockChat.interpret.mockResolvedValue({ reply: '', actionType: 'VAULT_QUESTION', confidence: 100 });
    mockVaultQuery.query.mockResolvedValue({ answer: 'Respuesta parcial', citations: [], confidence: 'LOW' });

    const svc = new CostitaChatService(mockDb as never, mockChat as never, mockVaultQuery as never);
    const res = await svc.interpret('user-1', { message: 'algo ambiguo' });

    expect(res.confidence).toBe(50);
    expect(res.reply).toBe('Respuesta parcial');
  });
});
