# Bitácora — MX-03: el costo fijo del tablero deja de reportarse completo sobre una clasificación incompleta

Primera tarea de la **Ola A** del plan de análisis marginal v2 (los números que el dueño ya está
viendo y ya están mal). El plan vive en `CosteAR-admin` — ver §"Dónde vive el plan" abajo.

## El bug

En `owner-dashboard-service.ts`, dentro de `costoPorCajon`, la rama `variable` respetaba la
incompletitud de la contribución marginal, pero la rama `fijo` llamaba a `completo(...)`
**siempre**, sin mirarla.

Efecto con un rubro sin clasificar frente al volumen: el tablero mostraba

```
costo variable: falta clasificar el rubro «Costos indirectos de producción»
costo fijo:     $18          ← solo la MOD; el CIP sin clasificar desapareció del número
```

Ese `$18` es la suma de los componentes que **sí** se clasificaron, dividida por las unidades
producidas. El rubro sin clasificar no aparece por ningún lado. **Un dato parcial presentado como
completo es peor que un dato faltante**: el dueño no tiene forma de saber que a ese número le
falta plata adentro.

Verificado contra `origin/dev` de hoy antes de tocar nada: el hallazgo sigue vivo (el plan se
escribió contra un `dev` de hace una semana, 58 commits atrás).

## Qué se hizo

`src/application/cost-structures/owner-dashboard-service.ts` — cuando la contribución marginal
viene incompleta, los **tres** indicadores de la fila (`variable`, `fijo`, `total`) salen
`incompleto` con los mismos motivos y los mismos `parametrosSinConfirmar`.

`total` también, aunque salga del motor y no dependa de la clasificación: los tres se leen como
una descomposición (`variable + fijo = total`), y un total exacto al lado de dos partes
desconocidas invita a deducir la que falta restando. Es la precisión falsa que **R13** prohíbe.

## Decisiones

- **El discriminante es `costoVariableUnitario === null`, no `incompleta`.** Son equivalentes
  (`contribucion-marginal.ts` los modela como unión discriminada), pero el primero es el que
  TypeScript usa para estrechar el tipo, así que mantenerlo evita un `!` de más.
- **`pendientes` no cambia.** `pendientesUnicos` ya ofrecía la acción una sola vez aunque varios
  indicadores dependan del mismo dato; se agregó un aserto que lo fija.
- **Sin ADR.** Es un bug, no una decisión nueva — así lo pide la propia tarea.

## Fuera de alcance

La **zona** de equilibrio que R13 pide en lugar del punto llega en `M1-03`. Acá el alcance es
solamente dejar de mentir.

## Dónde vive el plan (cierra la pregunta F del plan)

El plan propone guardarlo en `docs/planes/` de este repo. **No se puede**: el documento nombra al
cliente, a una persona del cliente y su estructura económica completa (contribución marginal
unitaria, punto de equilibrio, capacidad, precios de transferencia). Este repo es **público** y
**CLI-01/CLI-04** lo prohíben explícitamente. El plan va a `CosteAR-admin`, que es privado.

Tampoco se crea `docs/planes/`: **DOC-04** ya fija `docs/plans/` para este repo, y las reglas de
`CLAUDE.md` tienen prioridad sobre lo que diga un plan o un issue.

## Verificación

```
npx prisma generate                                              # CMD-02: el cliente estaba desactualizado
npm run typecheck                                                # verde
npx vitest run tests/http/owner-dashboard.test.ts                # 7/7 verdes (incluye el caso nuevo)
npx vitest run tests/http --no-file-parallelism                  # 20 archivos, 109 verdes
npx vitest run --exclude 'tests/http/**'                         # 1555 verdes, 1 skip
```

El único rojo de la suite rápida (`ingest-data-entry`) pasa aislado (7/7): es la contención de
máquina de siempre, no una regresión.
