# Por qué cambiamos cómo trabajamos

> Para el equipo. Se lee en tres minutos.

---

## El problema

En tres días (20 al 22-08-2026) se abrieron **24 pull requests** en el backend.
**Cuatro no agregaron nada**: existieron solo para recuperar trabajo que ya estaba hecho y se había
quedado afuera.

Ese **17 % fue re-trabajo puro**. Horas gastadas en mover cosas que ya funcionaban.

Antes de culpar a nadie, se midió qué **no** era el problema:

| Sospechoso | Medición | Veredicto |
|---|---|---|
| El código | 1.420 tests, suite en verde | No es |
| El CI | 42 corridas exitosas contra 2 fallidas (95 %) | No es |
| La doctrina de costeo | Cinco ADR verificados contra la cátedra | No es |

**El problema no estaba en el software. Estaba en el flujo entre personas y en el estado del
entorno.**

### La causa

El trabajo se pushea de a poco: se abre el PR y se le siguen agregando commits. Quien mergea ve un
PR abierto y en verde, y lo mergea. **Nada distinguía «esto está listo» de «esto todavía está
creciendo».**

Un PR se mergeó **12 minutos antes** de que llegara el commit que le faltaba.

Y el dato que ordenó todo lo demás:

> **La regla ya estaba escrita.** REV-08, del 18-08, pedía exactamente evitar esto. Volvió a pasar
> tres veces en los tres días siguientes.

De ahí sale la conclusión que guía todo lo que cambiamos:

> **Todo lo que dependía de la memoria de una persona falló.**
> **Todo lo que estaba automatizado funcionó.**
>
> Una regla que hay que recordar en el momento exacto no es un control: es una intención.

---

## El pedido

Santiago lo planteó así:

> *«Hay muchos errores, muchos problemas; necesito diagnosticar qué está pasando para poder recién
> solucionarlo.»*

Y después, cuando el diagnóstico estuvo:

> *«Necesito una forma en la que vayamos documentando y trazando todo. Pero que no le tenga que
> estar dando a mis compañeros una clase de cómo lo hice.»*

Dos pedidos distintos, y el segundo es el que importa a largo plazo: **que el contexto llegue solo.**

---

## La solución

### 1. Mecanismos en lugar de reglas

Donde antes había una regla escrita, ahora hay algo que funciona sin que nadie se acuerde:

| Antes | Ahora |
|---|---|
| «Acordate de verificar antes de mergear» | **El PR nace en draft.** GitHub no deja mergear un borrador |
| «Acordate de anotar el SHA del deploy» | **El CI verifica solo** que el ambiente sirva el commit mergeado, y falla si no |
| «Acordate de borrar la rama» | Se borra sola al mergear |
| «Acordate de aplicar las políticas de aislamiento» | Corren en cada deploy, dentro del `preDeployCommand` |

Ninguno de estos depende de que alguien lo recuerde en el momento exacto.

### 2. El contexto llega solo

**Al abrir tu sesión de Claude, un briefing automático te dice qué pasó** desde la última vez: si
`dev` avanzó, qué PRs hay abiertos, cuáles son tus issues, y qué conviene no tocar esta semana.

No hay que leer ningún documento antes de empezar. **La sesión arranca en contexto.**

### 3. El porqué queda escrito, no la clase

Cada decisión queda con **el número que la justifica** y con **las alternativas que se descartaron**,
para que nadie las vuelva a discutir desde cero. Está en `CLAUDE.md`, en los ADR y en el manual del
flujo.

---

## Qué cambia para vos, en concreto

Tu flujo de siempre sigue igual. Cambian dos clicks:

```
git add .  →  git commit  →  git push origin mi-rama  →  github  →  crear PR  →  mergear
                                                                        ↓             ↓
                                                                 elegí DRAFT     elegí SQUASH
```

- **Draft**: mientras tu trabajo crece, nadie te lo puede mergear por error. Cuando terminaste, le
  das *Ready for review*.
- **Squash**: un PR = un commit en `dev`. *(Las promociones `dev → staging → main` van con merge
  commit, no squash.)*

La web de GitHub y la terminal hacen exactamente lo mismo. **Usá la que te resulte cómoda.**

---

## Lo que NO cambió, a propósito

Se evaluaron y se descartaron, con motivo:

| Alternativa | Por qué no |
|---|---|
| Exigir aprobación de review para mergear | Con cuatro personas, traba. Draft + auto-merge atacan la misma causa sin poner a nadie a esperar |
| Prohibir los PRs apilados | No eran la causa: el cuarto incidente fue un PR simple |
| Escribir otra regla más | Es lo que ya se había hecho, y volvió a pasar tres veces |

---

## Dónde está el resto

| Qué | Dónde |
|---|---|
| Cómo trabajar, paso a paso | `docs/manual-de-flujo-de-trabajo.md` |
| Las reglas vinculantes | `CLAUDE.md` |
| Qué cambió el 22-08 en detalle | `docs/2026-08-22-cambios-de-flujo-y-ambientes.md` |
| Qué está pasando esta semana | `ESTADO.md` |
| El diagnóstico completo, con los números | `Auditorias/2026-08-20 auditoria consolidada y reparto.md`, §10 y §11 |
