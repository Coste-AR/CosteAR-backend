import { buildApp } from './app.js';
import { getEnv } from '../config/env.js';

/**
 * Punto de entrada del servidor HTTP. Carga y valida el entorno, construye la
 * app con toda la cadena de seguridad y escucha. Maneja shutdown ordenado.
 */
async function main(): Promise<void> {
  const env = getEnv();
  const app = await buildApp();

  const close = async (signal: string): Promise<void> => {
    app.log.info(`Recibido ${signal}, cerrando servidor...`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`CosteAR API escuchando en http://localhost:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
