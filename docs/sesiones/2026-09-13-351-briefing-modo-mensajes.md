---
issue: 351
repo: CosteAR-backend
pr: 353
rama: feat/briefing-modo-mensajes
agente: codex
modelo: gpt-5
tanda: B2
inicio: 2026-09-13T17:15-03:00
fin: 2026-09-13T17:25-03:00
minutos: 10
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-13 — El briefing abre el canal `/agente`

## Qué se hizo

- La primera línea del briefing declara el modo configurado en GitHub o informa que no pudo leerlo.
- Se buscan comentarios `/agente` de los últimos siete días en issues `listo`/`bloqueado` y PRs abiertos.
- Cada mensaje muestra fecha y hora argentina, autor, asunto y cuerpo completo, del más viejo al más nuevo.
- Las lecturas de GitHub fallan por separado: el briefing declara la parte ausente y termina normalmente.
- `AGENTS.md` obliga a leer el mensaje del issue elegido antes de tocar código.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** resolver el repositorio desde `GITHUB_REPOSITORY` o, fuera de Actions, con `gh repo view`.
  **Qué otra opción había:** fijar `Coste-AR/CosteAR-backend` en el script.
  **Por qué elegí esta:** mantiene el script portable en forks y copias sin perder el `-R` explícito que pide el issue.
- **Qué decidí:** traer las páginas de comentarios como JSON con `--paginate --slurp` y filtrar en Node.
  **Qué otra opción había:** hacer el filtro completo con `--jq`.
  **Por qué elegí esta:** conserva cuerpos multilínea sin separadores frágiles y permite probar cada regla sin depender de `jq` externo.
- **Qué decidí:** identificar si el comentario pertenece a un PR comparando su número contra la lista de PRs abiertos.
  **Qué otra opción había:** hacer una consulta por comentario.
  **Por qué elegí esta:** la API de comentarios de issues unifica issues y PRs; una sola lista evita hasta cien llamadas adicionales.

## Dónde el issue no alcanzaba

- No indicaba el formato exacto de fecha local. Se fijó `DD/MM/AAAA HH:mm ART`, sin depender de la zona horaria de la máquina.
- No indicaba cómo probar ejecutables externos de forma portable. Se agregó un shim optativo usado sólo por tests; la ejecución normal sigue invocando `git` y `gh` reales.
- El primer typecheck local se corrió después de `npm ci` pero antes de regenerar Prisma y dio errores falsos de tipos; `npm run prisma:generate` restauró el cliente y el typecheck quedó verde, como advierte el repo.

## Qué quedó afuera

- Disparar agentes por evento y contestar los mensajes desde el briefing; son límites explícitos de #351.

## Con qué se verifica

```bash
npm run prisma:generate                         # verde
npm run lint                                    # verde
npm run typecheck                               # verde
npm test -- tests/config/briefing-messages.test.ts  # 4 tests verdes
npm test                                        # 191 archivos, 1655 tests; verde al segundo intento
npm run check:tests-base                        # verde
node .claude/hooks/briefing.mjs --check-settings # verde
npm run briefing                                # sprint + /agente real de #351 a las 17:04 ART
```

La primera corrida completa tuvo tres timeouts aislados en tests HTTP no modificados; la segunda pasó completa sin cambios. El rojo deliberado fue la corrida del test del nuevo contrato antes de modificar el script.
