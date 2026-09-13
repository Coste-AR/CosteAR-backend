/**
 * Fixture "del lado del frontend" (#282, fase 1).
 *
 * Este archivo simula lo que consume `Coste-AR/CosteAR-frontend#128`: importa
 * SOLO `types.d.ts`, generado a partir del contrato — nada de Fastify, Prisma,
 * `getEnv()` ni ningún módulo de servidor. Se typechequea aparte con su propio
 * `tsconfig.json` (`npm run typecheck:openapi-consumer`), que no extiende el
 * `tsconfig.json` raíz del backend: si este archivo compilara solo porque
 * heredó algo del backend, la prueba de "es type-only" sería falsa.
 *
 * Es la "corrida en verde" del punto 5 de "Proof that it works": renombrar un
 * campo en `owner-dashboard.schema.ts`, correr `npm run openapi:generate` y
 * `npm run typecheck:openapi-consumer` en este archivo, y ver que esta función
 * deja de compilar sin tocar una línea de este código.
 */
import type { paths } from './types.js';

type TableroResponse =
  paths['/periods/{id}/tablero-dueno']['get']['responses'][200]['content']['application/json'];

export function resumenTablero(tablero: TableroResponse): string {
  const { data } = tablero;
  if (!data.corrida) return `Período ${data.periodo.codigo}: sin corrida de cálculo.`;
  const costo = data.costoPorCajon.total.valor;
  return costo === null
    ? `Período ${data.periodo.codigo}: costo por unidad incompleto.`
    : `Período ${data.periodo.codigo}: costo por unidad $${costo.toFixed(2)}.`;
}
