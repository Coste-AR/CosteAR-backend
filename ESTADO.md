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

- ✅ **La Fase 3 cerró.** El PR #144 entró y el #72 está cerrado: la deriva del schema ya no se
  filtra, se acabó. **`prisma/schema.prisma` vuelve a estar libre** — la prohibición de ayer no corre.
- 🟡 **Si el schema vuelve a derivar, el script aborta en vez de filtrar.** Las 7 sentencias que se
  cerraron ya no se sacan en silencio: `scripts/migrate-dev.mjs` para y dice con qué se había
  cerrado. Si te frena, es una señal real — no la esquives.
- ⚠️ **La suite NO está 100 % verde.** `indirect-costs-capacidad-normal` falla ~1 de cada 4 corridas
  por timeout (#145): corre a 3900 ms contra un límite de 5000 ms. Es **flaky conocido y ya
  diagnosticado** — si lo ves en rojo no re-corras la suite, está todo en el issue.
- ⚠️ **`main` es producción y `staging` es pre-producción.** Mergear a `main` publica. Hoy hay
  **5 commits en `staging` sin promover a `main`**.
- ✅ **El flujo, desde el 30-08-2026: nadie mergea a mano.** El PR nace en draft; cuando está
  terminado y en verde se marca listo (`gh pr ready`) y se le pone la etiqueta **`auto-merge`**.
  De ahí lo mergea `.github/workflows/auto-merge.yml`: **squash** a `dev`, **merge commit** en las
  promociones a `staging`, y `main` sigue siendo a mano — es producción.
  **La etiqueta es la decisión, el merge es del workflow.** No hay reviews requeridos en ningún
  repo, así que esa etiqueta es lo que reemplaza al review: sin ella, cualquier PR entraría solo
  con que el semáforo se ponga verde. Ver `docs/manual-de-flujo-de-trabajo.md`.
- 📌 **#115 y #116 son el mismo patrón**: el dominio, la tabla y la RLS ya existen; falta el
  servicio o la ruta que los use. Ahora que la Fase 3 cerró, **no hay nada bloqueándolos**.

**En curso:** Santiago — promover `staging`→`main` · Giuliana — #73, #115, #116, #145 ·
Lautaro — #95, #96, #97, #98.
