# Decisiones — Trazabilidad Total v1

Registro vivo de decisiones tomadas de forma autónoma durante la implementación
de la especificación "Trazabilidad Total v1", en la branch `AlanSandbox`.
Regla general: ante ambigüedad, default más simple que cumpla la spec sin
arriesgar pérdida de datos.

## Alcance de esta sesión

- **Frontend inexistente en este checkout**: el repo React de CosteAR no está
  clonado en esta máquina (carpeta `GIt Front` vacía). La Sección D de la spec
  pide componentes React concretos que no puedo tocar sin ese repo. Decisión:
  implementar el 100% del backend (A, B, C) tal como está especificado, y
  agregar una página de demo estática (HTML+JS vanilla, sin build step) dentro
  de este repo (`public/demo/`) que consume la API real y reproduce el árbol
  de cálculo y la TraceCard, para poder verificar visualmente en Chrome. Esto
  NO reemplaza la integración real en el frontend de producción — es un arnés
  de verificación. Cuando el repo de frontend esté disponible, portar la
  lógica de esa demo a componentes React reales.
- **Sin Docker/Postgres en este entorno**: no se puede levantar la base ni
  correr migraciones contra una DB real desde acá. Las migraciones se escriben
  y se validan con `prisma validate`/`prisma generate` (sintaxis y consistencia
  de schema), pero no se ejecutan. El usuario debe correr
  `docker-compose up -d && npm run prisma:migrate` en su máquina antes de usar
  el servidor. Se documentan los pasos exactos al final.

## Modelo de datos

- **No se reutiliza la tabla `audit_logs` existente**: ya existe un modelo
  `AuditLog` (`@@map("audit_logs")`) usado en toda la app con columnas
  distintas (`oldValue`/`newValue`, sin `method`/`actor_role`/`actor_area`).
  Repurposarla violaría R1 (nada se pisa) si tuviera que alterar columnas con
  datos ya cargados en producción. Decisión: tabla nueva `TraceAuditLog`
  (`@@map("trace_audit_log")`) con el esquema exacto de la spec, usada
  exclusivamente por las mutaciones nuevas de trazabilidad. El audit log
  legado sigue existiendo para las acciones que ya lo usaban.
- **No se reutiliza `CostCalculation`**: ídem — es el snapshot legado del
  motor viejo (usado por `/cost-structures/:id/calculate` y `/simulate`, que
  se mantienen intactos por compatibilidad). Las tablas nuevas
  `CalculationRun`/`CalculationNode` implementan el árbol persistido que pide
  la spec y alimentan los endpoints nuevos `/api/v1/structures/:id/calculate`,
  `/calculation-runs/:id/tree`, `/structures/:id/runs`.
- **`actor_area` no existe hoy en el JWT** (el token solo lleva `role`). Se
  agrega como campo obligatorio en el body de cada endpoint mutante nuevo de
  trazabilidad (`sourceArea`), validado contra el enum `source_area`. Es la
  opción más simple que no requiere tocar el esquema de autenticación ni
  reemitir tokens existentes.
- **Migración de datos existentes** (data_points para lo ya cargado): se
  implementa como script idempotente (`scripts/backfill-trazabilidad.mjs`,
  `npm run db:backfill-trazabilidad`) que recorre `CostStructure` con
  configuración cargada y crea un `data_point`+`version 1` **por bloque**
  (MP/MOD/CIP/VENTA completo, no campo por campo) con `method='manual'`,
  `reason='migración: dato pre-trazabilidad'`, `actorRole='desconocido (migrado)'`.
  Granularidad por bloque (no por campo individual) porque el modelo legado no
  guarda quién cargó cada campo particular — inventar esa granularidad sería
  fabricar información que no existe. Los datos NUEVOS cargados a través de
  los endpoints nuevos sí son por campo (ver `field_key` tipo
  `mp.compra.precio`). No corre como parte de la migración de Prisma (las
  migraciones SQL no deberían tener lógica de negocio ni loops sobre JSON):
  es un paso manual documentado en las instrucciones finales.
- **RLS**: las tablas nuevas no tienen columna `userId` propia (se relacionan
  vía `structureId`/`runId` a `cost_structures`). Se agregaron políticas RLS
  en `prisma/rls.sql` para `data_points`, `data_point_versions`,
  `calculation_runs` y `calculation_nodes` vía subquery/join al dueño de la
  estructura, siguiendo el mismo patrón que las tablas existentes.
  `evidence` y `trace_audit_log` no tienen RLS directo (su vínculo con el
  tenant es indirecto u opcional); se protegen en la capa de aplicación con el
  mismo patrón `requireStructure`/`requireDataPoint` que usa el resto del
  código.
- **Endpoint adicional no listado en la spec**: `POST /structures/:id/data-points`
  (crear un data point nuevo). La spec no lo incluye en la lista de la sección
  C, pero sin él `POST /data-points/:id/versions` no tiene sobre qué actuar —
  algún endpoint tiene que crear la versión 1. Se agregó siguiendo el mismo
  contrato de auditoría/transacción que el resto.

## Motor de cálculo

- **No se reescriben las funciones puras existentes** (`raw-material.ts`,
  `direct-labor.ts`, `indirect-costs.ts`, `cost-statement.ts`): ya están
  verificadas contra la metodología de cátedra y tienen tests. Reescribirlas
  para que devuelvan nodos en vez de números arriesga romper la matemática
  (violaría R5 - regresión cero). Decisión: se agrega una capa nueva
  (`tree-builder.ts`) que envuelve los resultados YA calculados por las
  funciones puras existentes y arma el árbol `{label, formula, value, unit,
  sources[], children[]}` a partir de ellos. El árbol se persiste en
  `calculation_nodes`; el motor original queda como única fuente de verdad
  numérica.
- **Fix del prorrateo secundario (500→422)**: al revisar el código, el
  prorrateo secundario YA se recalcula en cada `calculate()` (no depende de un
  valor persistido — `secondaryProration` corre siempre en memoria) y también
  al guardar CIF (`updateConfig`). El bug original (500 crudo) se debía a que,
  si faltaba un insumo (capacidad normal = 0, sin presupuesto, concepto sin
  base de distribución), el motor tiraba un `Error` genérico de JS que el
  error handler no traducía. Se agrega la clase `UnprocessableEntityError`
  (422) y se envuelven los puntos de falla conocidos del motor para que
  lancen ese error tipado con `code: 'MISSING_INPUT'` y mensaje accionable en
  español.
