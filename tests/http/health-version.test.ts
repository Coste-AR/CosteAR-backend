import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '@/infrastructure/http/app.js';

/**
 * EL HEALTHCHECK TIENE QUE DECIR QUÉ VERSIÓN ESTÁ CORRIENDO.
 *
 * No es un detalle de prolijidad. Durante la auditoría del 20-08 la pregunta
 * «¿este defecto está afectando al cliente?» quedó sin respuesta en los tres
 * casos, siempre por el mismo motivo: **nadie sabía qué SHA corría en cada
 * ambiente**. El runbook pedía anotarlo a mano después de cada deploy, y anotar
 * a mano algo que la plataforma ya sabe es una promesa que se incumple sola.
 *
 * Estos tests fijan el contrato que el runbook da por hecho cuando dice que
 * `/health` devuelve `{ status, version }`. Si alguien simplifica el endpoint,
 * se entera acá y no tres semanas después, frente a un cliente preguntando.
 */
describe('healthcheck — qué versión corre acá', () => {
  const originales = { ...process.env };

  afterEach(() => {
    process.env = { ...originales };
  });

  it('expone la versión y el ambiente que inyecta Railway', async () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = 'abc1234def5678';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'staging';

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBe('abc1234def5678');
    expect(body.environment).toBe('staging');
    await app.close();
  });

  it('sin la variable de Railway dice «desconocido», no inventa un valor', async () => {
    // Un healthcheck que devuelve un SHA plausible cuando en realidad no sabe
    // cuál es, es peor que uno que no devuelve nada: alguien lo va a leer como
    // si fuera cierto y va a concluir mal sobre qué está deployado.
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    delete process.env.GIT_COMMIT_SHA;

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.json().version).toBe('desconocido');
    await app.close();
  });

  it('sigue respondiendo 200 y `status: ok`: es lo que mira el monitoreo', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
    expect(typeof res.json().ts).toBe('string');
    await app.close();
  });
});
