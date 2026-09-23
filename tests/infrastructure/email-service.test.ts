import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailService } from '@/infrastructure/email/email-service.js';
import { resetEnvCache } from '@/infrastructure/config/env.js';

beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.NODE_ENV = 'test';
  resetEnvCache();
});

describe('EmailService — vocabulario visible', () => {
  it('renderiza la invitación al portal sin vocabulario prohibido', async () => {
    const service = new EmailService();
    const send = vi.fn().mockResolvedValue(undefined);
    Object.assign(service, { send });

    await service.sendOperatorInvite(
      'persona@ejemplo.test',
      'Ana',
      'Taller Norte',
      'temporal-segura',
      'ABC123',
    );

    const [, subject, html] = send.mock.calls[0]!;
    expect(`${subject}\n${html}`).not.toMatch(/\b(?:costista|pymes?|empresa)\b/i);
    expect(html).toContain('Taller Norte');
    expect(html).toContain('ABC123');
  });
});
