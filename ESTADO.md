<!--
  EL MENSAJE DEL ORQUESTADOR.

  Este archivo se inyecta ENTERO al principio de cada sesión de Claude, en los
  tres repos. Es el único lugar del proyecto que dice qué está pasando ahora
  mismo, y por eso vale más corto que completo.

  Reglas para mantenerlo:
   - Máximo 20 líneas. Si no entra, es que algo de acá ya no está pasando.
   - Solo lo que cambia lo que alguien va a hacer HOY. Lo histórico va a docs/.
   - "No tocar" siempre con el motivo al lado: una prohibición sin razón se
     ignora o se pregunta, y las dos cuestan.
   - Actualizarlo al empezar y al cerrar un bloque de trabajo.

  El hook saca los comentarios HTML como éste antes de inyectar: son para nosotros,
  no gastan contexto de la sesión.
-->

**Actualizado: 25-08-2026**

- 🔴 **No toques `prisma/schema.prisma`**: la Fase 3 está **en vuelo** en el PR #144 (draft).
  Cualquier cambio al schema ahora conflictúa con él. Si necesitás un campo, avisá antes.
- 🟡 **#146 es lo que desbloquea el #144** y necesita Docker: es el único paso que falta para
  cerrar #72 de verdad. El resultado va como comentario en el PR, salga bien o mal.
- ⚠️ **La suite NO está 100 % verde.** `indirect-costs-capacidad-normal` falla ~1 de cada 4
  corridas por timeout (#145): corre a 3900 ms contra un límite de 5000 ms. Es **flaky conocido y
  ya diagnosticado** — si lo ves en rojo no re-corras la suite, está todo en el issue.
- ⚠️ **`main` es producción y `staging` es pre-producción.** Mergear a `main` publica.
- ✅ **El flujo**: el PR nace en draft y se mergea con squash. Las promociones
  (`dev→staging→main`) van con merge commit, **no** squash. Ver `docs/manual-de-flujo-de-trabajo.md`.
- 📌 **#115 y #116 son el mismo patrón**: el dominio, la tabla y la RLS ya existen; falta el
  servicio o la ruta que los use. **Cero schema**, así que corren en paralelo a la Fase 3.

**En curso:** Santiago — Fase 3 (#144) y desatascar el pipeline (#94) · Giuliana — #146, #73, #115,
#116, #145 · Lautaro — sus issues asignados.
