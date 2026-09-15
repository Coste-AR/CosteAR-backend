# F0 — Reconocimiento — AUD-2026-09-15

## Alcance de esta tanda

Continuación dirigida de `AUD-2026-09-14` (papeles en `docs/auditorias/AUD-2026-09-14/`). Esa
auditoría cerró con opinión **ADVERSA** y dos CRÍTICOS que bloqueaban M2-M4 del proceso avícola:
`AUD-2026-09-14-04a` (conversión de unidades no representable) y `AUD-2026-09-14-05` (período
cerrado resuelve contra clasificación vigente). Esta sesión responde un pedido puntual en cinco
pasos:

1. Experimento controlado sobre si `04a` es representabilidad pura o una falla más general.
2. Cargar `FX-AV-B` (Planta→Embolsado, conversión kg→bolsa exacta) por API, M1→M4, cerrando en
   secuencia.
3. Comportamiento del sistema cuando los períodos se mueven (orden de cierre, reapertura en
   cascada, dato tardío, magnitud de AUD-05, recálculo de período cerrado).
4. Auditoría del módulo `period-comparison` (entró en la tanda anterior) contra la serie.
5. Capturas en pantalla con los cuatro períodos cargados.

## Entorno

- Backend: rama `auditoria/AUD-2026-09-14` @ `a249414` (commit vigente al abrir esta sesión),
  servidor real en `localhost:3000` (el que usa el frontend, ver más abajo) y `localhost:3001`
  (proceso separado, misma base). **Los dos procesos comparten la misma Postgres
  (`localhost:5433`) pero NO son intercambiables para el login del frontend** — ver nota en
  `05-capturas.md` sobre por qué la carga de datos para las capturas se hizo contra el puerto 3000.
- Frontend: `Costear.web/CosteAR-frontend`, rama `auditoria/AUD-2026-09-14` = `origin/staging`,
  servidor real en `localhost:5173`, proxy `/api` → `http://localhost:3000` (`vite.config.ts:14`).
- Fixture: `.claude/skills/costear-auditoria/scripts/calc_fx_av.py` — corrido con `--assert` antes
  de usar cualquier número: **`OK — 36 cuadres verificados`** (incluye los 3 nuevos de `FX-AV-B`,
  variante que ya vivía en el script pero no estaba documentada en `fixtures-avicola.md` — la
  fuente de verdad es el script, ver su comentario en `calc_fx_av.py:287-293`).
- Registro real por `/auth/register` en cada script; nada insertado a mano en la base. Todas las
  empresas de prueba de esta sesión quedan en la base compartida de desarrollo, sin limpiar
  (mismo criterio que la tanda anterior).

## `FX-AV-B` — qué es y por qué no estaba en el documento

`references/fixtures-avicola.md` llega hasta su §11. `FX-AV-B` vive en `calc_fx_av.py` (líneas
285-341) con este comentario del propio script:

> *"Variante FX-AV-B: existe para auditar el comportamiento ENTRE PERIODOS sin chocar con el
> defecto AUD-2026-09-14-04a. La conversión kg→bolsa es 1/50 = 0,02 exacto, representable en
> Decimal(18,6); la del huevo (1/360, 1/30, 1/12) es periódica y no lo es. Mismo flujo, distinta
> conversión: es un experimento controlado sobre el defecto."*

Es decir: el propio fixture ya traía diseñado, desde antes de este pedido, el experimento del
PASO 1. Las anclas de planta (`references §3`) y de embolsado citadas en el pedido de esta sesión
se verificaron contra el script (fuente de verdad) antes de usarse — **coinciden exactas**, cifra
por cifra, con la salida de `dump_paso2_inputs.py` (ver `evidencia/`).

## Scripts de evidencia de esta sesión

Todos en `evidencia/`, corridos con `node` (v24.18.0) contra el backend real:

| Script | Qué hace |
|---|---|
| `paso1-experimento.mjs` | PASO 1 — conversión 1/50 vs 1/360, mismo endpoint y flujo |
| `dump_paso2_inputs.py` | Vuelca en JSON los inputs exactos de Planta/Embolsado, reusando las funciones puras de `calc_fx_av.py` |
| `paso2-fxavb-m1-m4.mjs` | PASO 2 — carga M1→M4 de `FX-AV-B` por API, cerrando en secuencia. Exporta `cargarFxAvB()` para reutilizar en los pasos siguientes |
| `paso3-periodos-movibles.mjs` | PASO 3.A/B/C/E sobre la serie ya cargada |
| `paso3d-aud05-magnitud.mjs` | PASO 3.D — reclasificación sobre período cerrado, estructura ORDERS mínima |
| `paso4-period-comparison.mjs` | PASO 4 — llamadas en vivo a `/structures/:id/periods/compare` |

Los `.log` con prefijo `run1-`/`run2-` son corridas que fallaron por un problema de mi propio
guión de carga (no del sistema) — se conservan como evidencia de diagnóstico, no se borran
(DOM-01 aplicado también a los papeles de trabajo).
