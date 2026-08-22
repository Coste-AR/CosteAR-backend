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

**Actualizado: 22-08-2026**

- 🔴 **No tocar `prisma/schema.prisma` ni crear migraciones**: arranca la Fase 3 (deriva del schema,
  issue #72). Si necesitás un campo nuevo, avisá antes.
- ⚠️ **`main` es producción y `staging` es pre-producción** desde hoy. Mergear a `main` publica.
  El mapa viejo (los dos ambientes sirviendo `staging`) ya no vale.
- ✅ **El flujo cambió**: el PR nace en draft y se mergea con squash. Las promociones
  (`dev→staging→main`) van con merge commit, **no** squash. Ver `docs/manual-de-flujo-de-trabajo.md`.
- ✅ La suite está 100 % verde y el lint en cero. Si ves un rojo, **es real**: no lo ignores.

**En curso:** Santiago — Fase 3 (schema) · Giuliana — sus issues asignados.
