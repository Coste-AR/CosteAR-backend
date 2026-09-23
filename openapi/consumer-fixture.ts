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

type LoginResponse =
  paths['/auth/login']['post']['responses'][200]['content']['application/json'];

type CalculationResponse =
  paths['/cost-structures/{id}/calculate']['post']['responses'][200]['content']['application/json'];

type PuntoIndiferenciaResponse =
  paths['/companies/{companyId}/analisis/punto-indiferencia']['post']['responses'][200]['content']['application/json'];

type RelacionReemplazoResponse =
  paths['/companies/{companyId}/analisis/relacion-reemplazo']['post']['responses'][200]['content']['application/json'];

export function sesionIniciada(response: LoginResponse): string {
  return `${response.data.user.name} · ${response.data.user.role}`;
}

export function margenCalculado(response: CalculationResponse): string {
  return `${response.data.result.grossMarginPct.toFixed(2)}%`;
}

export function resumenTablero(tablero: TableroResponse): string {
  const { data } = tablero;
  if (!data.corrida) return `Período ${data.periodo.codigo}: sin corrida de cálculo.`;
  const costo = data.costoPorCajon.total.valor;
  return costo === null
    ? `Período ${data.periodo.codigo}: costo por unidad incompleto.`
    : `Período ${data.periodo.codigo}: costo por unidad $${costo.toFixed(2)}.`;
}

export function resumenPuntoIndiferencia(response: PuntoIndiferenciaResponse): string {
  const { cantidadIndiferencia, motivoSinPunto, unidades } = response.data;
  return cantidadIndiferencia === null
    ? motivoSinPunto ?? 'No existe un punto de indiferencia.'
    : `${cantidadIndiferencia} ${unidades.cantidad}`;
}

export function resumenRelacionReemplazo(response: RelacionReemplazoResponse): string {
  const { resultadoCortoPlazo, resultadoLargoPlazo, unidades } = response.data;
  return resultadoCortoPlazo === null || resultadoLargoPlazo === null
    ? response.data.motivo ?? 'No existe una relación de reemplazo.'
    : `Corto: ${resultadoCortoPlazo} ${unidades.resultadoCortoPlazo}; largo: ${resultadoLargoPlazo} ${unidades.resultadoLargoPlazo}.`;
}
