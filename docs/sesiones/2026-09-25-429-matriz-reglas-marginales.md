---
issue: 429
repo: Coste-AR/CosteAR-backend
pr: 484
rama: test/matriz-reglas-marginales
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-25T02:59:00-03:00
fin: 2026-09-25T03:09:00-03:00
minutos: 10
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# Bitácora — V-A1: matriz R1–R35

## Recursos

- Verificación: `npx vitest run tests/scripts/matriz-reglas-marginales.test.ts`, `npm run lint`,
  `npm run typecheck`, `npm run test` y repetición focalizada de los tres archivos que agotaron
  el timeout bajo carga paralela.
- Resultado: meta-test 36/36; lint y typecheck verdes; suite 1996/1999 por tres timeouts; los tres
  archivos repetidos pasaron 31/31.

## Decisiones tomadas

- La matriz vive como JSON dentro de los fixtures de análisis marginal. La alternativa era leer
  en CI el plan privado de Admin; se descartó porque haría depender la suite pública de otro repo.
- Se valida archivo y título literal. La alternativa era buscar sólo etiquetas como `AM-13`, que
  no demostraría qué caso ejecutable sostiene cada regla.
- O1-02, M9-01 y M12-01 se declaran aparte como alcances posteriores. No se los presenta como
  cobertura implementada (Constitución §2).

## Camino rojo

R28 apuntó a propósito a un título inexistente. El meta-test falló mostrando R28, archivo y título;
al restaurar el título real pasó 36/36 (Constitución §5).

## Dónde el issue no alcanzaba

- No definía el formato persistente de la matriz ni cómo hacer disponible la §4 privada en CI.
  Se eligió JSON por ser legible tanto por personas como por Vitest.

## Qué quedó afuera

- O1-02: descomposición de capacidad en tres vías.
- M9-01: programación lineal con más de una restricción activa.
- M12-01: cotización de producción a pedido.
