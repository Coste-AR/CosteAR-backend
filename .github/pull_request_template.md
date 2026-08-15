<!--
  Usá `Closes #N` solo si este PR cierra el issue ENTERO.
  Si quedan gaps reales, poné `part of #N` — cerrar un issue a medias esconde trabajo pendiente.
-->

Closes #

## Qué

<!-- Qué hace este PR, en 2-3 bullets. -->

-

## Por qué

<!-- El motivo. Si hubo una decisión no obvia, linkeá el ADR: docs/adr/NNNN-slug.md -->

## Cambios

| Archivo | Cambio |
| --- | --- |
| | |

## Cómo probarlo

### Automático

- [ ] `npm run lint` pasa
- [ ] `npm run typecheck` pasa
- [ ] `npm test` pasa
- [ ] `npm run test:integration` pasa (si tocó RLS, aislamiento o queries)

### Manual

<!-- Pasos exactos para verificarlo. Los tests unitarios NO validan un flujo. -->

1.

## Checklist

- [ ] Issue vinculado
- [ ] Commits convencionales y atómicos
- [ ] Tests escritos o actualizados
- [ ] `.env.example` actualizado si agregué variables
- [ ] Migraciones **aditivas** (nada de `DROP` sobre tablas con datos)
- [ ] Si toqué el motor de cálculo: los fixtures de "Piezas mecánicas de precisión" y los 3 casos de ITCS siguen dando exactamente lo mismo
- [ ] Decisión no trivial documentada en `docs/adr/`
