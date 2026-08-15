---
name: Bug
about: Algo que no funciona como debería
title: 'Bug: <qué se rompió>'
labels: 'type:bug'
---

## Contexto

<!-- Qué se rompió y cuál es el impacto. ¿Lo está viendo el cliente? -->

**¿Afecta a un cliente en producción?** sí / no

## Cómo reproducirlo

1.
2.
3.

## Esperado vs. real

**Esperado:**

**Real:**

## Evidencia

<!-- Logs, captura, respuesta JSON, número mal calculado. Cuanto más crudo, mejor. -->

```

```

## Notas técnicas

- Área sospechada: `src/...`

## Definition of Done

- [ ] Causa raíz documentada como comentario en el issue
- [ ] Fix implementado y verificado a mano
- [ ] **Test de regresión agregado** (que falle sin el fix)
- [ ] Lint y typecheck pasan
- [ ] PR abierto, revisado y mergeado
- [ ] Si afectaba al cliente: verificado en staging antes de promover
