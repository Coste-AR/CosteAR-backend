---
name: Feature / Mejora
about: Funcionalidad nueva o mejora de una existente
title: '<área> — <descripción en imperativo>'
labels: 'type:feature'
---

## Contexto

<!--
  POR QUÉ hace falta esto: motivo de negocio, restricción técnica o decisión de producto.
  Específico, 2-4 oraciones. El "para qué", no el "qué".
-->

<!-- Si ya se tomó una decisión no obvia, dejala explícita: -->
<!-- > **Decisión AAAA-MM-DD:** ... -->

## Alcance

<!--
  Subsecciones con contenido real, no una lista plana de bullets.
  Backend  → ### Modelo de datos | ### Endpoints | ### Lógica de negocio
  Frontend → ### Rutas | ### Componentes | ### Estado / queries
  Poné los modelos y las firmas de endpoints en bloques de código.
-->

###

## Criterios de aceptación

<!-- Cómo sabemos que está bien. Verificables, no opiniones. -->

- [ ]

## Notas técnicas

<!--
  Gotchas, restricciones, patrones a seguir, variables de entorno o dependencias.
  OJO: esto es una SUGERENCIA, no una orden. Quien implementa valida contra el repo real.
-->

-

## Definition of Done

- [ ] Implementado y andando localmente
- [ ] Probado a mano (no alcanza con los tests unitarios)
- [ ] Tests escritos
- [ ] Lint y typecheck pasan
- [ ] PR abierto, revisado y mergeado a `dev`
- [ ] Decisión no trivial documentada en `docs/adr/`
- [ ] Issue cerrado y tarjeta movida a Done
