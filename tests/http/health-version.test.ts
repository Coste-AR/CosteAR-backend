import { describe, it, expect } from 'vitest';
import { healthPayload } from '@/infrastructure/http/health.js';

/**
 * EL HEALTHCHECK TIENE QUE DECIR QUÉ VERSIÓN ESTÁ CORRIENDO.
 *
 * No es prolijidad. Durante la auditoría del 20-08 la pregunta «¿este defecto
 * está afectando al cliente?» quedó sin respuesta en los tres casos, siempre por
 * el mismo motivo: **nadie sabía qué SHA corría en cada ambiente**. El runbook
 * pedía anotarlo a mano después de cada deploy, y anotar a mano algo que la
 * plataforma ya sabe es una promesa que se incumple sola.
 *
 * Estos tests fijan el contrato que el runbook da por hecho.
 *
 * Se le pasa el entorno como argumento en vez de tocar `process.env`: así no
 * dependen del orden en que corren ni ensucian a los demás. Y se prueba la
 * función, no `buildApp()`, porque construir la app entera arrastra Prisma y las
 * colas —que exigen `DATABASE_URL`— y **el CI de tests unitarios no levanta
 * Postgres a propósito**. Un test que solo corre donde hay base no protege nada
 * en el lugar por donde pasan todos los cambios: la primera versión de este
 * archivo hacía exactamente eso y el CI lo rebotó con «0 test».
 */
describe('healthcheck — qué versión corre acá', () => {
  it('expone la versión y el ambiente que inyecta Railway', () => {
    const r = healthPayload({
      RAILWAY_GIT_COMMIT_SHA: 'abc1234def5678',
      RAILWAY_ENVIRONMENT_NAME: 'staging',
    } as NodeJS.ProcessEnv);

    expect(r.status).toBe('ok');
    expect(r.version).toBe('abc1234def5678');
    expect(r.environment).toBe('staging');
  });

  it('sin la variable de Railway dice «desconocido», no inventa un valor', () => {
    // Un healthcheck que devuelve un SHA plausible cuando en realidad no sabe
    // cuál es, es peor que uno que no devuelve nada: alguien lo va a leer como
    // si fuera cierto y va a concluir mal sobre qué está deployado.
    const r = healthPayload({} as NodeJS.ProcessEnv);

    expect(r.version).toBe('desconocido');
    expect(r.environment).toBe('desconocido');
  });

  it('acepta `GIT_COMMIT_SHA` como respaldo si algún día no se deploya en Railway', () => {
    const r = healthPayload({ GIT_COMMIT_SHA: 'deadbeef' } as NodeJS.ProcessEnv);
    expect(r.version).toBe('deadbeef');
  });

  it('cae a NODE_ENV para el ambiente cuando Railway no lo informa', () => {
    const r = healthPayload({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(r.environment).toBe('development');
  });

  it('mantiene `status: ok` y una marca de tiempo: es lo que mira el monitoreo', () => {
    const r = healthPayload({} as NodeJS.ProcessEnv);

    expect(r.status).toBe('ok');
    expect(new Date(r.ts).toString()).not.toBe('Invalid Date');
  });
});
