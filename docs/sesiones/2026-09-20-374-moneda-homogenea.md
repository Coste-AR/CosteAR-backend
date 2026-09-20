---
issue: 374
repo: CosteAR-backend
pr: 394
rama: feat/374-moneda-homogenea-v2
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-20T12:03:48-03:00
fin: 2026-09-20T12:33:13-03:00
minutos: 29
tokens: no-informado
clears: 0
intentos_hasta_verde: 4
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-20 — Pesos comparables sin reescribir la historia

## Qué se hizo

- Se agregó una serie mensual por empresa, con fuente y momento cero fijos.
- Cada corrección crea un snapshot completo nuevo; las versiones y valores tienen
  RLS y trigger append-only.
- La capa previa al motor reexpresa existencias y compras antes del PPP. La ficha
  auditada no se modificó.
- Los cálculos guardan el id de la versión efectivamente aplicada y las respuestas
  declaran si están en moneda homogénea o nominal.
- Las comparaciones reexpresan el período viejo al índice del nuevo. Sin los dos
  valores conservan cifras nominales y listan los períodos ausentes.
- Se publicaron las rutas de carga/lectura y el contrato en OpenAPI.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** si falta cualquier índice necesario, toda la ficha queda nominal.
  **Qué otra opción había:** reexpresar las filas completas y mezclar los huecos
  nominales en el mismo PPP. **Por qué elegí esta:** un promedio mixto aparentaría
  comparabilidad sin tenerla; aplica Constitución §2 y §3.
- **Qué decidí:** una corrección crea un snapshot completo, no sólo una fila suelta.
  **Qué otra opción había:** reconstruir la versión siguiendo una cadena de deltas.
  **Por qué elegí esta:** el id que guarda el cálculo queda autocontenido y auditable;
  aplica Constitución §2 y la regla append-only del dominio.
- **Qué decidí:** R33 prevalece sobre el factor anual escrito en el criterio.
  **Qué otra opción había:** forzar `1,4034`. **Por qué elegí esta:**
  `(1,08 / 1,05)^12` da `1,4022`; forzar otro valor inventaría matemática financiera.
- **Qué decidí:** usar la rama `feat/374-moneda-homogenea-v2`.
  **Qué otra opción había:** borrar o mover el worktree viejo que conserva
  `feat/374-moneda-homogenea`. **Por qué elegí esta:** la rama anterior estaba limpia
  pero seguía asociada a otro worktree; no se destruyó estado ajeno.

## Dónde el issue no alcanzaba

- El criterio dice `×1,4034` a doce meses, pero la fórmula obligatoria R33 da
  `×1,4022`. La discrepancia queda explicitada en ADR 0026 y en el PR.
- No definía si una serie parcial podía producir un agregado parcialmente
  homogeneizado. Se eligió fallback nominal para no mezclar monedas.
- No decía si la referencia de versión alcanzaba con deltas. Se eligió snapshot
  completo para que la referencia de una corrida pueda leerse sin reconstrucción.

## Qué quedó afuera

- Fuente automática de índices: la decisión del 18-09 fija carga manual en esta tanda.
- Interfaz de carga: el issue pertenece al carril backend.

## Con qué se verifica

```bash
npm run lint                                      # verde
npm run typecheck                                 # verde
npm run test -- --maxWorkers=2                   # 1.829 verdes; 4 skipped existentes
npm run test:http -- --maxWorkers=2              # 140 verdes
npm run test:integration -- --maxWorkers=2       # 81 verdes, RLS real
npm run test:db -- --maxWorkers=2                # 66 verdes
npm run build                                     # verde
npm run check:tests-base                         # verde
npm run check:openapi                            # 22 operaciones, verde
npm run typecheck:openapi-consumer               # verde
npx prisma validate                              # schema válido
```

El rojo deliberado inicial ejecutó AM-10 antes de crear
`moneda-homogenea.ts`: falló por módulo inexistente. La primera corrida general
tuvo un mock HTTP desactualizado por el nuevo campo obligatorio `currency` y el
timeout flaky conocido de `admin-stats`; se corrigió el mock y ambos pasaron
aislados, luego la suite general completa quedó verde con dos workers.
