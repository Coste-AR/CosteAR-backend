---
title: "Prompt para Claude Code — Trazabilidad Total v1"
tags: [costear, desarrollo, prompt, trazabilidad]
fecha: 2026-07-10
origen: "Derivado de Manual-Trazabilidad-DEVS-v1"
---

# Prompt para Claude Code (implementación automática en la branch)

> **Antes de pegar el prompt:** (1) copiá `Manual-Trazabilidad-DEVS-v1.md` desde la bóveda a la **raíz del repo**; (2) abrí la terminal en la carpeta del repo con tu branch ya activa; (3) corré `claude` y pegá TODO lo de abajo; (4) aceptá los permisos de lectura/escritura que pida.

---

```
Sos el implementador técnico de CosteAR (SaaS de costos para costistas, backend Node/Postgres en Railway, frontend React en Vercel). Vas a implementar la especificación "Trazabilidad Total v1" trabajando solo, por fases, con commits limpios, sin romper nada de lo que ya calcula bien. Yo no soy técnico: no me preguntes cosas de código, decidí vos con criterio y documentá.

FUENTE DE VERDAD
- Leé primero el archivo Manual-Trazabilidad-DEVS-v1.md en la raíz del repo. Es la especificación completa (modelo de datos, motor, API, frontend, fases F0-F5, criterios de aceptación). Si el archivo no está, frenà y pedímelo antes de tocar nada.

ANTES DE TOCAR CÓDIGO
1. Explorá el repo: stack real, estructura de backend y frontend, ORM/queries, cómo se corren migraciones, cómo se levanta local, si hay tests. 
2. Mostrame un resumen de 10 líneas: qué encontraste y cómo mapeás las tablas/endpoints del manual a lo que ya existe (nombres reales).
3. Armá el plan por fases y arrancá sin esperar confirmación.

REGLAS DURAS (no negociables, del §0 del manual)
1. Nada se pisa: valores de costos se VERSIONAN (append-only), borrado = lógico. Jamás DELETE/UPDATE destructivo sobre datos cargados.
2. Toda mutación escribe su entrada de bitácora EN LA MISMA transacción (rollback conjunto).
3. Timestamps del servidor, en timestamptz. Nunca la hora del cliente.
4. Ningún 500 crudo al usuario: errores de cálculo/validación responden 422 con {code, message, field} en español accionable.
5. REGRESIÓN CERO en la matemática. Después de CADA fase, el caso "Piezas mecánicas de precisión" tiene que seguir dando exactamente: MP consumida $2.043.076,92 · ITCS 84,51% · MOD $4.981.786,82 · CIP aplicados $900.000,00 · Costo producción $7.924.863,75 · Margen 25,2% ($2.675.136,25). Y los tres casos del ITCS de la cátedra: 0,799903 / 0,676078 / 0,390833. Si no hay tests, creá un suite mínimo (jest o vitest) con estos números como fixtures ANTES de modificar el motor.

CÓMO TRABAJAR
- Quedate en la branch actual. NO toques main. NO hagas push: solo commits locales, uno por bloque funcional, mensaje tipo feat(trazabilidad): ... / fix(calc): ...
- Migraciones SIEMPRE aditivas (CREATE TABLE, ALTER ADD COLUMN). Nada de DROP.
- Si el stack real difiere del asumido en el manual, adaptá nombres y herramientas pero NO el modelo conceptual.
- Ante ambigüedad: elegí el default más simple que cumpla el manual, anotalo en un archivo DECISIONES.md en la raíz, y seguí. Solo frenà a preguntarme si hay riesgo de pérdida de datos.

ORDEN DE EJECUCIÓN (una fase = uno o más commits + tests verdes)
F1 — Bitácora y versiones: tablas data_points / data_point_versions / evidence / audit_log (§1 del manual), triggers append-only, middleware audited() en todas las rutas mutantes, versionado con reason obligatorio en correcciones, migración de datos existentes como version_n=1 (reason: "migración: dato pre-trazabilidad").
F2 — Runs y árbol de derivación: el motor emite el árbol mientras calcula (§2, patrón Node), tablas calculation_runs / calculation_nodes, endpoints GET /calculation-runs/:id/tree y GET /structures/:id/runs, POST /calculate transaccional que persiste run+nodos+bitácora. FIX CRÍTICO: el cierre del prorrateo secundario debe correr al guardar CIF Y también dentro de calculate si falta (idempotente); si aún falta un insumo, 422 con mensaje claro, nunca 500. La pestaña Historial se llena desde /runs.
F3 — Ficha del dato: GET /data-points/:id/trace con el contrato JSON exacto del §4, y en el frontend la TraceCard in-place (acordeón bajo la fila clickeada, una sola abierta): estado+firma, autores por campo con rol/área/hora exacta, método+dispositivo, comprobante, historial de versiones, cadena de impacto, id inmutable. Botón "Pedir revisión" que crea entrada en Validaciones + bitácora.
F4 — Doble período: fecha_hecho / fecha_captacion (server) / periodo_imputado en data_points, regla proposeImputation del §3, modal de imputación con las dos opciones y registro de la decisión en bitácora, dato sin imputar no entra al cálculo (aparece en pendientes), métrica de latencia de captación.
F5 — Pulido: IAP como campo calculado de solo lectura con fórmula visible (sacarlo de los conceptos editables; renombrar a "IAP — Inasistencias pagas"), limpiar el flag "Tenés cambios sin guardar" tras guardar, keys estables por id (no por nombre) al renombrar centros de costo para no perder porcentajes tipeados, reemplazar los valores de demo precargados de MOD por placeholders + botón "Cargar ejemplo".

VERIFICACIÓN (después de cada fase)
- Corré la suite completa + lint/typecheck si existen.
- Verificá el checklist §7 del manual correspondiente a la fase y mostrame la evidencia (output de tests, ejemplo de respuesta JSON, captura de la migración aplicada).

AL TERMINAR TODO
Escribí un resumen final para no-técnicos: qué se hizo en cada fase, qué decisiones tomaste (link a DECISIONES.md), cómo lo pruebo yo en local paso a paso (comandos exactos para copiar y pegar), y qué quedó pendiente o para revisar con el equipo antes de mergear.
```
