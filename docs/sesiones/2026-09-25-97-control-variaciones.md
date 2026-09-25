---
issue: 97
repo: CosteAR-backend
pr: 482
rama: fix/control-variaciones-c1
agente: codex
modelo: gpt-5
tanda: C1
inicio: 2026-09-25T00:56-03:00
fin: 2026-09-25T01:04-03:00
minutos: 8
tokens: no-informado
clears: 0
intentos_hasta_verde: 4
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-25 — El control de variaciones vuelve al circuito

## Qué se hizo

- Se recuperó el cambio que había quedado únicamente en la rama huérfana
  `fix/control-variaciones-ppto-volumen` y se lo aplicó sobre el `dev` vigente.
- El cálculo por órdenes ahora controla, centro por centro, que la variación presupuesto más la
  variación volumen sea la inversa de la sobre/subaplicación.
- La salida de consistencia informa si todos los centros cumplen, la peor diferencia y los centros
  que exceden la tolerancia.
- Se agregó cobertura para el centavo de redondeo del caso Terminación, para un desvío real de un
  peso y para el borde exacto de la tolerancia.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** reaplicar el commit huérfano `1c9a9d9` sobre `origin/dev` y conservar su ADR.
  **Qué otra opción había:** reescribir la implementación desde cero o seguir trabajando sobre la
  rama de agosto. **Por qué elegí esta:** el issue indicó expresamente recuperar ese trabajo, el
  commit aplicó limpio y partir del `dev` actual evita revivir una base desactualizada. Se aplicó
  Constitución §5: los casos negativo y de borde quedaron en la misma propuesta.
- **Qué decidí:** mantener el control como información de consistencia, sin bloquear el cálculo.
  **Qué otra opción había:** convertir la diferencia en un error del cálculo. **Por qué elegí esta:**
  el issue pide que el defecto avise y el ADR original documenta que el control de materia prima ya
  usa el mismo contrato informativo.

## Dónde el issue no alcanzaba

- El issue no indicaba cómo trasladar el trabajo huérfano al `dev` que avanzó desde agosto. Se eligió
  una rama nueva desde `origin/dev` y se reaplicó el único commit lógico, que no produjo conflictos.
- La primera suite completa se lanzó en paralelo con lint y typecheck. Cinco tests HTTP agotaron su
  timeout de cinco segundos; al correr `npm run test` solo, los 1.957 tests pasaron. No se modificó
  código ni configuración para esconder esos timeouts.

## Qué quedó afuera

- No se cambió el redondeo de `Money` ni ningún valor del motor.
- No se tocaron endpoints, base de datos, RLS ni migraciones; por eso no correspondieron
  `test:http`, `test:integration` ni `test:db` como suites separadas.

## Con qué se verifica

```bash
npx vitest run tests/domain/indirect-costs.test.ts tests/application/calculate.test.ts
# 2 archivos, 34 tests: verde

npm run lint
# verde

npm run typecheck
# verde

npm run test
# 239 archivos pasaron, 1 omitido; 1957 tests pasaron, 4 omitidos
```
