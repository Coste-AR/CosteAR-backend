# 0007 — Detectar por análisis estático las validaciones que se construyen y nunca se llaman

- **Fecha:** 2026-08-20
- **Estado:** Aceptada
- **Decide:** Lautaro (issue asignado por Santiago)
- **Contexto de origen:** issue #98, que cruza las tres auditorías del 19 y 20 de agosto

## Contexto

CosteAR tiene una costumbre que ya produjo un defecto real: **construir la validación, testearla, y no llamarla desde ningún lado.**

El precedente es `checkRawMaterialConsistency`. Comparaba la materia prima consumida por ficha de stock contra la del estado de costos — el control que la cátedra pide expresamente. Existía, tenía tests propios en verde, y **no la invocaba nadie**: el sistema tenía el detector de inconsistencias apagado. Hoy se engancha en `calculate.ts`, con el motivo escrito ahí mismo.

No fue un caso aislado. Al 20-08-2026, medido sobre `dev`:

| Qué | Estado |
|---|---|
| `GET /structures/:id/allocation-check` | Registrada, devuelve el mensaje correcto, **cero llamadores** — ni en este repo ni en el frontend |
| `src/domain/calculations/desperdicio.ts` | 114 líneas de dominio + su tabla + 181 de test; **único importador: su archivo de test** |
| `src/domain/parametros/activo-amortizable.ts` | Mismo patrón, misma migración (S-03/S-04) |
| `src/domain/parametros/parametros-costeo.ts` | Mismo patrón |
| `src/domain/alertas/reglas-alerta.ts` | **249 líneas mergeadas a `dev` el 19-08**, un día después de la auditoría que describió el patrón |

Ese último es el punto. El issue #98 lo dice antes de que pasara: *"Arreglar los cuatro síntomas uno por uno no impide el quinto."* El quinto ya estaba en `dev` cuando se fue a buscarlo.

Un módulo de dominio que solo importa su test es **doctrina codificada que el producto no ejecuta**: la suite pasa en verde y el usuario no recibe nada. Es el peor modo de falla posible, porque se parece exactamente al éxito.

## Decisión

Se agrega `tests/config/validaciones-enchufadas.test.ts`, un **test estático sin base de datos** que se pone rojo cuando:

1. una ruta de validación registrada (`…-check`, `…/validate`) no la nombra ningún otro archivo del repo, o
2. un módulo de `src/domain/` no lo importa ningún archivo de `src/`.

Lleva **dos** diccionarios, con las mismas guardas que `EXENTAS` en `rls-coverage.test.ts` (sin fantasmas, sin contradicciones, sin placeholders):

- `EXENCIONES` — casos legítimos y permanentes: las cuatro rutas que solo consume el frontend, cada una con el archivo y la línea que la llama.
- `DEUDA_CONOCIDA` — los cinco hallazgos vivos, **cada uno con su issue**: `allocation-check` (#100), `desperdicio.ts` (#92), `reglas-alerta.ts` (#74), `parametros-costeo.ts` (#115) y `activo-amortizable.ts` (#116), los dos hallazgos nuevos que destapó este test.

**Se entrega en verde**, con los cinco hallazgos anotados como deuda. Un test agregado en rojo dejaría el CI de `dev` rojo de forma permanente hasta que se cierren cinco issues ajenos, y eso choca de frente con `PR-02` y `GIT-05`. Peor: un CI rojo crónico hace que la gente deje de mirarlo, y lo primero que se pierde con eso son los hallazgos **nuevos**, que es lo único que este archivo aporta y los issues no.

Para que "deuda" no sea un sinónimo cómodo de "silenciado", **hay un test que exige que toda entrada de `DEUDA_CONOCIDA` nombre un issue**. Un hallazgo sin issue no es deuda: es un hallazgo perdido.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| **Chequeo dinámico: levantar la app y ver qué rutas se ejercitan** | El CI no levanta Postgres (ver ADR 0001). Un control que se saltea justo donde pasan todos los cambios no protege nada. Y "no la llama nadie" **no es observable en runtime**: que una corrida no pase por una ruta no prueba que esté muerta |
| **Regla de ESLint (`no-unused-modules`)** | Razona por archivo y no distingue "importado por un test" de "importado por el producto", que es exactamente la distinción que importa acá |
| **Arreglar los cuatro síntomas y no construir el detector** | Es lo que se venía haciendo. `reglas-alerta.ts` demuestra que no alcanza: el quinto caso apareció solo |
| **Entregarlo en rojo, como pide literalmente el issue** | Deja el CI de `dev` rojo hasta que se cierren cinco issues ajenos. Rompe `PR-02` y `GIT-05`, y bloquea al equipo entero por un hallazgo que ya está escrito en sus issues |
| **Entregarlo verde con un `EXENCIONES` único** | Mezcla "esto está bien así" con "esto está mal y lo sabemos" en la misma lista. A los dos meses nadie distingue cuál era cuál y la deuda se vuelve invisible |
| **Comparar cadenas en vez de resolver los imports** | Se probó primero y **da falsos positivos**: `money.ts` se importa de cinco formas distintas y una búsqueda textual encuentra una. Daba `percentage.ts` por huérfano teniendo dos importadores reales |

## Consecuencias

**A favor**

- Cualquier validación nueva que nazca desconectada se delata el día que se escribe, no seis meses después.
- Corre en el job de CI que ya existe: sin Docker, sin base, sin claves, ~1,5 s.
- Encontró dos módulos huérfanos que ninguna auditoría había nombrado (`activo-amortizable.ts`, `parametros-costeo.ts`) y uno posterior a ellas (`reglas-alerta.ts`).

**En contra / lo que aceptamos pagar**

- **El test solo ve este repo.** `CosteAR-frontend` es otro repositorio, así que una ruta que solo consume la web se vería muerta desde acá. Se resuelve con exenciones que citan archivo y línea del frontend — verificable a mano, pero **se desactualiza en silencio** si el frontend deja de llamarla.
- Heurísticas de texto sobre el código fuente: reconoce `app.get('…')` literal. Una ruta armada dinámicamente se le escapa.
- **El CI queda en verde con cinco problemas abiertos adentro.** Es el costo real de esta decisión: quien mire solamente el semáforo no se entera de que existen. La mitigación es que `DEUDA_CONOCIDA` es un inventario legible, con su issue por línea, y que la guarda del issue impide agrandarlo en silencio.
- **Dos de los cinco los encontró este test, no una persona** (#115 y #116). Eso es a favor del test y en contra del proceso: eran una tabla, una migración, una política de RLS y su lógica de dominio, todo mergeado, sin nadie que las leyera.

**Qué se rompe si alguien la revierte sin leer esto**

- Vuelve el patrón sin red: se construye la validación, se testea, no se llama, y la suite verde lo tapa. Ya pasó cinco veces documentadas.

## Cómo se verifica que sigue vigente

```bash
npx vitest run tests/config/validaciones-enchufadas.test.ts
```

Hoy: **7 en verde**, con los cinco hallazgos en `DEUDA_CONOCIDA`.

Dos comprobaciones que valen más que el verde:

1. **Sigue cazando lo nuevo.** Agregar un archivo cualquiera bajo `src/domain/` que nadie importe pone el test en rojo en la corrida siguiente. Verificado el 20-08 con un archivo descartable.
2. **La deuda se vacía sola.** Cada vez que se cierra uno de los issues #100, #92, #74, #115 o #116, se borra su línea. El día que `DEUDA_CONOCIDA` quede vacío, el patrón está cerrado.
