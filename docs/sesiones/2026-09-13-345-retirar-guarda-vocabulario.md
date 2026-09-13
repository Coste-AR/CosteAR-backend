---
issue: 345
repo: CosteAR-backend
pr: 347
rama: chore/issue-345-retirar-huellas
agente: codex
modelo: gpt-5
tanda: B2
inicio: 2026-09-13T12:10-03:00
fin: 2026-09-13T12:16-03:00
minutos: 6
tokens: no-informado
clears: 0
intentos_hasta_verde: 4
rojos_deliberados: 0
rebotes_de_guarda: 0
---

# 2026-09-13 — Retiro de una guarda sin uso del vocabulario

## Qué se hizo

Se retiraron las huellas de datos de tenant, la función que las validaba y su
único test. El seed conserva sus 61 términos y el mismo circuito de limpieza y
upsert.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** eliminar también `normalizar`, `huella` y el import de
  `node:crypto`.
- **Qué otra opción había:** dejarlos como código muerto.
- **Por qué elegí esta:** existían exclusivamente para el mecanismo retirado y
  conservarlos contradecía el objetivo del issue.

## Dónde el issue no alcanzaba

No hubo supuestos funcionales. La primera ejecución de la suite específica
requirió generar el cliente Prisma del worktree nuevo, según el setup del repo.

## Qué quedó afuera

Nada.

## Con qué se verifica

```bash
npm run prisma:generate
npm test -- tests/config/seed-vocabulario-privacidad.test.ts
npm run lint
npm run typecheck
npm run test
git grep -n HUELLAS_DE_DATOS_TENANT
git grep -n validarVocabularioPublico
```

La suite específica pasó 2 tests. La suite completa pasó 1643 tests y omitió
4. La comparación del arreglo `terminos` contra `origin/dev` dio 61 entradas en
ambos casos y el mismo SHA-256:
`9431df100e4cd641a7eb44903bdf003169590ab76d7e1d62efc28391dab0c2e6`.
Ambos `git grep` devolvieron vacío.
