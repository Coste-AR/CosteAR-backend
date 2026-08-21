/**
 * QUÉ VERSIÓN ESTÁ CORRIENDO ACÁ.
 *
 * Durante la auditoría del 20-08 la pregunta «¿este defecto está afectando al
 * cliente?» quedó sin respuesta en los tres casos, siempre por lo mismo: **nadie
 * sabía qué SHA corría en cada ambiente**. El runbook pedía anotarlo a mano
 * después de cada deploy, y anotar a mano algo que la plataforma ya sabe es una
 * promesa que se incumple sola.
 *
 * Vive en su propio módulo —y no adentro de `app.ts`— para que se pueda testear
 * sin construir la aplicación entera: `buildApp()` arrastra Prisma y las colas,
 * que exigen `DATABASE_URL`, y el CI de tests unitarios **no levanta Postgres a
 * propósito**. Un test del healthcheck que solo corre donde hay base no protege
 * nada en el lugar por donde pasan todos los cambios.
 */
export interface HealthPayload {
  status: 'ok';
  /** SHA del commit deployado, o 'desconocido' si el ambiente no lo informa. */
  version: string;
  /** Ambiente de Railway (staging/main) o el NODE_ENV como respaldo. */
  environment: string;
  ts: string;
}

export function healthPayload(env: NodeJS.ProcessEnv = process.env): HealthPayload {
  return {
    status: 'ok',
    // `RAILWAY_GIT_COMMIT_SHA` la inyecta Railway en cada deploy. Si no está, se
    // dice 'desconocido' en vez de inventar: un SHA plausible pero falso es peor
    // que ninguno, porque alguien lo va a leer como si fuera cierto y va a
    // concluir mal sobre qué está deployado.
    version: env.RAILWAY_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA ?? 'desconocido',
    environment: env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV ?? 'desconocido',
    ts: new Date().toISOString(),
  };
}
