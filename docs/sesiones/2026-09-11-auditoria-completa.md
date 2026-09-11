# Bitácora — auditoría completa de decisiones (RAG + organización)

## Qué se hizo

Repaso de todas las decisiones tomadas en el rediseño del RAG y en el plan de organización de
Claude Code, verificado contra el disco y `git` (no contra lo que ya decían los documentos).

### Higiene (verificado y corregido)

- **Worktrees stale con secretos**: `.claude/worktrees/feat-vault-qa/` (con `.env` real — JWT
  keys, `DATABASE_URL`, etc. — de 22/07) y `.claude/worktrees/feat-vault-rag-indexing/` (vacío).
  Se removieron con `git worktree remove --force` + `git branch -D worktree-feat-vault-qa`.
  **Corrección sobre la alarma anterior**: se revisó toda la historia de `git log --all` y ese
  `.env` **nunca se agregó a un commit** — `.claude/worktrees/` está en `.gitignore` desde antes.
  No hubo exposición pública. Sí quedó recomendado rotar las claves si esa notebook estuvo
  respaldada/compartida alguna vez.
- **Contaminación de `C:\Users\giuli\Documents\CosteAR\.claude`** (D-01/D-03/D-04 del plan de
  organización): 25 skills genéricos + 12 agentes genéricos sin relación con CosteAR, más
  `.agents/AGENTS.md` y `.superpowers/brainstorm/` sueltos. Se borró la carpeta `.claude`, `.agents`
  y `.superpowers` enteras de la carpeta contenedora (no es un repo git, así que no hay historia
  que preservar). El `.claude` propio de `CosteAR-backend` (6 skills `costear-*`) no se tocó.

### ADRs retroactivos

- **`docs/adr/0013-harness-de-evals-propio-en-vez-de-promptfoo.md`**: F1-12 construyó un harness
  propio (`tests/rag/eval-runner.ts`) en vez del Promptfoo que sugería el spec. Se ratifica —
  Promptfoo estaba marcado 🟡 en `herramientas-a-evaluar.md`, no era una recomendación firme.
- **`docs/adr/0014-contexto-por-chunk-sin-batch-api-de-anthropic.md`**: F1-05 genera el
  `contextualPrefix` con llamadas agrupadas (`BATCH_SIZE=5`, `Promise.all`) en vez de la Batch API
  real de Anthropic (–50%). Se ratifica por ahora — con 92 notas el costo es centavos igual; queda
  anotado para revisar cuando F1-03/F1-14 hagan crecer la bóveda.

## Fuera de alcance (quedan para después)

- Sentry Cron Monitor en `nightly-learning` — pendiente, issue a crear.
- Spike de Atlas contra `filtrar-deriva.mjs` / bug #309 — pendiente, issue a crear.
- `claude-code-action@v1` para review automático de PRs — pendiente, necesita decidir el secret.

## Verificación

```
git worktree list                    # solo queda el worktree principal
find .claude/worktrees -maxdepth 3   # vacío
# carpeta contenedora: .claude, .agents, .superpowers ya no existen
```
