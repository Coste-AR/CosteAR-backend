import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WhatsappWebhookService,
  ofuscarNumero,
} from '../../src/application/empresa/whatsapp-webhook-service.js';

/**
 * WEBHOOK DE WHATSAPP — que nada se descarte en silencio.
 *
 * Los dos primeros casos de este archivo **fijaban el defecto**: se llamaban
 * "ignora mensajes que no tienen texto" e "ignora si el número no está
 * registrado", y verificaban que efectivamente no pasara nada.
 *
 * Ignorar era el bug. En un canal de campo, el operario cree que cargó un dato
 * que nunca cargó, y el costista se entera semanas después cuando el mes no
 * cuadra.
 *
 * Ahora se verifica lo contrario: que cada camino que no termina en una ingesta
 * deje una alerta con el motivo.
 */

const { mockDb, mockIngest } = vi.hoisted(() => ({
  mockDb: {
    empresaConnection: { findUnique: vi.fn() },
    dataEntry: { create: vi.fn() },
    // El servicio de alertas escribe acá. Antes no hacía falta en el mock
    // justamente porque el webhook nunca avisaba de nada.
    systemAlert: { create: vi.fn() },
  },
  mockIngest: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));
vi.mock('../../src/application/ingest/ingest-data-entry.js', () => ({
  ingestDataEntry: mockIngest,
}));

/** Doble del servicio de alertas: interesa QUÉ se avisó, no cómo se persiste. */
function hacerAlertas() {
  return { create: vi.fn().mockResolvedValue(undefined) } as never;
}

const CONEXION = {
  id: 'conn-1',
  costistId: 'user-1',
  companyId: 'comp-1',
};

beforeEach(() => vi.clearAllMocks());

describe('WhatsappWebhookService — ningún mensaje se descarta en silencio', () => {
  it('una FOTO no se descarta: no ingesta, pero deja alerta con el motivo', async () => {
    mockDb.empresaConnection.findUnique.mockResolvedValue(CONEXION);
    const alerts = hacerAlertas();
    const svc = new WhatsappWebhookService(mockDb as never, alerts);

    await svc.handleMessage('5493815551234', { image: { id: 'media-1' } });

    expect(mockIngest, 'todavía no se puede procesar la imagen').not.toHaveBeenCalled();
    expect((alerts as never as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledTimes(1);

    const aviso = (alerts as never as { create: ReturnType<typeof vi.fn> }).create.mock.calls[0]![0];
    expect(aviso.source).toBe('whatsapp-webhook');
    expect(aviso.message).toContain('imagen');
    // Lo que hace accionable la alerta: decir que la persona NO fue avisada.
    expect(aviso.message).toMatch(/no recibió ninguna respuesta/i);
  });

  it('un AUDIO tampoco: se nombra el tipo que llegó, no un genérico', async () => {
    mockDb.empresaConnection.findUnique.mockResolvedValue(CONEXION);
    const alerts = hacerAlertas();
    const svc = new WhatsappWebhookService(mockDb as never, alerts);

    await svc.handleMessage('5493815551234', { audio: { id: 'a-1' } });

    const aviso = (alerts as never as { create: ReturnType<typeof vi.fn> }).create.mock.calls[0]![0];
    expect(aviso.message).toContain('audio');
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it('un número NO registrado deja alerta: puede ser un operario sin dar de alta', async () => {
    mockDb.empresaConnection.findUnique.mockResolvedValue(null);
    const alerts = hacerAlertas();
    const svc = new WhatsappWebhookService(mockDb as never, alerts);

    await svc.handleMessage('5493819998888', { text: { body: 'silo 3: 12 toneladas' } });

    expect(mockIngest).not.toHaveBeenCalled();
    const aviso = (alerts as never as { create: ReturnType<typeof vi.fn> }).create.mock.calls[0]![0];
    expect(aviso.message).toMatch(/no registrado/i);
    // Tiene que decir qué hacer, no solo que pasó.
    expect(aviso.message).toMatch(/dar de alta|cargalo/i);
  });

  it('el número se ofusca en las alertas: alcanza con los últimos 4 dígitos', async () => {
    mockDb.empresaConnection.findUnique.mockResolvedValue(null);
    const alerts = hacerAlertas();
    const svc = new WhatsappWebhookService(mockDb as never, alerts);

    await svc.handleMessage('5493819998888', { text: { body: 'hola' } });

    const aviso = (alerts as never as { create: ReturnType<typeof vi.fn> }).create.mock.calls[0]![0];
    expect(aviso.message).toContain('****8888');
    expect(aviso.message, 'el número completo no debería quedar en la alerta').not.toContain(
      '5493819998888',
    );
  });

  it('un TEXTO de un número registrado sigue procesándose igual que antes', async () => {
    mockDb.empresaConnection.findUnique.mockResolvedValue(CONEXION);
    const alerts = hacerAlertas();
    const svc = new WhatsappWebhookService(mockDb as never, alerts);

    await svc.handleMessage('5493815551234', { text: { body: 'silo 3: 12 toneladas' } });

    expect(mockIngest).toHaveBeenCalledTimes(1);
    const [input] = mockIngest.mock.calls[0]!;
    expect(input.connectionId).toBe('conn-1');
    expect(input.rawContent).toBe('silo 3: 12 toneladas');
    expect(input.sourceType).toBe('WHATSAPP');
    // El camino feliz no genera alerta: si no, se llena de ruido y se ignoran todas.
    expect((alerts as never as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
  });
});

describe('ofuscarNumero', () => {
  it('deja los últimos 4 dígitos', () => {
    expect(ofuscarNumero('5493815551234')).toBe('****1234');
  });

  it('no rompe con entradas cortas o vacías', () => {
    expect(ofuscarNumero('12')).toBe('****');
    expect(ofuscarNumero('')).toBe('****');
  });
});
