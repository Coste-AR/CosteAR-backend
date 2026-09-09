import { InvalidInitialTermsContentError, type TermsService } from '../../application/legal/terms-service.js';
import type { Env } from '../config/env.js';

type InitialTermsSeeder = Pick<TermsService, 'ensureInitialVersion'>;

/**
 * Si los términos son inválidos en producción no hay arranque degradado: esa
 * condición es determinística y aceptar registros dejaría una evidencia legal
 * inmutable con texto incompleto. Las fallas transitorias sí conservan el
 * comportamiento degradado histórico para que una base momentáneamente caída
 * no deje fuera de servicio al healthcheck.
 */
export async function seedInitialTermsAtStartup(
  terms: InitialTermsSeeder,
  nodeEnv: Env['NODE_ENV'],
): Promise<void> {
  try {
    const seeded = await terms.ensureInitialVersion();
    if (seeded) console.log(`[startup] Sembrada la versión inicial de Términos (v${seeded.version}).`);
  } catch (err) {
    if (nodeEnv === 'production' && err instanceof InvalidInitialTermsContentError) {
      throw err;
    }
    console.warn(
      '[startup] WARN: no se pudo sembrar los Términos y Condiciones — el registro puede estar bloqueado hasta que se resuelva:',
      err,
    );
  }
}
