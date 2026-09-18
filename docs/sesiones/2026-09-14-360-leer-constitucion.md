---
issue: 360
repo: CosteAR-backend
pr: 364
rama: chore/360-leer-constitucion
agente: codex
modelo: gpt-5
tanda: B2
inicio: 2026-09-14T20:01-03:00
fin: 2026-09-14T20:10-03:00
minutos: 9
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-14 — La Constitución se lee antes del issue

## Qué se hizo

- `AGENTS.md` manda leer la Constitución de CosteAR antes de leer el issue y enlaza su fuente única en `CosteAR-os`.
- Si un issue contradice uno de sus diez principios, el agente debe informarlo en el issue y no implementar el pedido.
- Las decisiones tomadas sobre la marcha deben citar en la bitácora el principio aplicado como `Constitución §N`.
- El registro de cambios de `AGENTS.md` documenta la nueva regla normativa.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** ubicar el párrafo inmediatamente después del comando `npm run briefing`.
  **Qué otra opción había:** colocarlo después de la explicación completa del briefing.
  **Por qué elegí esta:** el issue pidió explícitamente ese lugar y así ambas lecturas previas quedan juntas. `Constitución §7`.
- **Qué decidí:** enlazar la Constitución sin copiar ni resumir sus diez principios.
  **Qué otra opción había:** agregar una lista local de principios.
  **Por qué elegí esta:** conserva una única fuente normativa y respeta el fuera de alcance. `Constitución §7`.

## Dónde el issue no alcanzaba

- No definía el texto exacto ni la extensión de la fila del registro; se mantuvo el estilo y la cronología descendente existentes.

## Qué quedó afuera

- No se cambió el briefing ni se copió o resumió la Constitución, tal como delimita #360.
- No se tocó ningún archivo fuera de `AGENTS.md` y esta bitácora.

## Con qué se verifica

```bash
# Aserción del contrato antes del cambio: rojo esperado por enlace ausente
# (`ROJO esperado: falta el enlace a CONSTITUCION.md`).
# Aserción del contrato después del cambio: verde.
npm ci                                      # verde
npm run prisma:generate                     # verde
npm run lint                                # verde
npm run typecheck                           # verde
npm run test                                # verde al segundo intento: 195 archivos y 1670 tests
npm test -- tests/http/admin-stats.test.ts tests/http/owner-dashboard.test.ts tests/http/parametros-costeo.test.ts
                                            # 3 archivos y 24 tests verdes
```

La primera suite completa tuvo tres timeouts aislados en esos archivos HTTP no modificados; los
24 tests pasaron al ejecutarlos juntos y la segunda suite completa quedó verde sin cambios.
