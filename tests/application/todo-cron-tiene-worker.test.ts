import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * TODO CRON PROGRAMADO TIENE QUE TENER QUIÉN LO CONSUMA.
 *
 * Este error se cometió dos veces. La primera con el pipeline nocturno: se
 * encolaba el job y nadie lo procesaba, y quedó un comentario en `server.ts`
 * avisándolo. La segunda con el cálculo diario, dos líneas más abajo del mismo
 * comentario.
 *
 * Programar un repetible en BullMQ y no levantar su worker no falla en ningún
 * lado: el job se encola prolijamente y se queda ahí. No hay error, no hay log,
 * no hay nada — solo un cálculo que nunca ocurre. Es el peor tipo de bug.
 *
 * `railway.toml` define UN SOLO proceso (`startCommand`), así que
 * `workers/index.ts` no corre en el deploy: si el worker no está en `server.ts`,
 * en producción no existe.
 *
 * Este test lee los dos archivos y compara. Es rudimentario a propósito: no hay
 * forma de preguntarle a BullMQ "¿alguien escucha esta cola?" sin levantar Redis.
 */

const raiz = process.cwd();
const leer = (...p: string[]) => readFileSync(join(raiz, ...p), 'utf8');

describe('Crons y workers', () => {
  it('cada cola con cron registrado tiene su worker levantado en el proceso web', () => {
    const repeatables = leer('src/infrastructure/workers/repeatable-jobs.ts');
    const server = leer('src/infrastructure/http/server.ts');

    // Las colas que `registerRepeatableJobs` programa.
    const programadas = [...repeatables.matchAll(/ensureRepeatable\(\s*(\w+Queue)/g)].map(
      (m) => m[1]!,
    );
    expect(programadas.length).toBeGreaterThan(0);

    // `macroSyncQueue` → `startMacroSyncWorker`, `dailyRunQueue` → `startDailyRunWorker`.
    const sinWorker = programadas.filter((cola) => {
      const base = cola.replace(/Queue$/, '');
      const nombreWorker = `start${base.charAt(0).toUpperCase()}${base.slice(1)}Worker`;
      return !server.includes(nombreWorker);
    });

    expect(
      sinWorker,
      `Estas colas tienen cron programado pero nadie las consume en server.ts: ${sinWorker.join(', ')}. ` +
        'El job se va a encolar y quedar ahí para siempre, sin error ni log.',
    ).toEqual([]);
  });

  it('el proceso worker aparte levanta los mismos workers que el web', () => {
    const server = leer('src/infrastructure/http/server.ts');
    const workers = leer('src/infrastructure/workers/index.ts');

    const enWorkers = [...workers.matchAll(/start(\w+)Worker\(\)/g)].map((m) => m[1]!);
    const faltanEnServer = enWorkers.filter((w) => !server.includes(`start${w}Worker`));

    // Si los dos procesos levantan cosas distintas, el comportamiento depende de
    // cuál esté corriendo — que es exactamente lo que hizo invisible este bug.
    expect(faltanEnServer).toEqual([]);
  });
});
