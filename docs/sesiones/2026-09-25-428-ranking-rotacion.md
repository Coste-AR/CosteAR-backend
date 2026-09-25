---
issue: 428
repo: CosteAR-backend
pr: 483
rama: feat/ranking-rotacion
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-25T01:59-03:00
fin: 2026-09-25T02:13-03:00
minutos: 14
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-25 — Ranking comercial que combina margen y rotación

## Qué se hizo

- Se agregó la carga append-only de rotación declarada por segmento y período, con trazabilidad en la misma transacción y RLS.
- Se publicó el ranking por `cm/S = Vel × m`, el criterio alternativo por margen con advertencia, los excluidos sin dato y el origen declarado/default.
- Se habilitó `velocidad_rotacion_default` como parámetro sin valor de catálogo: si nadie lo carga, se declara ausencia.
- Se agregó el fixture AM-13, pruebas de dominio y del contrato HTTP, y se regeneró OpenAPI.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** el GET exige `periodoId` como query. **Alternativa:** inferir un período activo. **Por qué:** la rotación es periódica y la Constitución §2/§9 prohíbe inventar cuál período quiso consultar la persona.
- **Qué decidí:** la última fila declarada por fecha gana. **Alternativa:** rechazar una segunda carga. **Por qué:** el issue exige append-only para cambiar el valor, por lo que la lectura debe resolver la versión más reciente.
- **Qué decidí:** el margen es `(precioUnitario - costoVariableUnitario) / precioUnitario`. **Alternativa:** persistir otro dato. **Por qué:** es la definición `m` de la fórmula de referencia y ambos componentes ya viven en `SegmentoAnalisis`.
- **Qué decidí:** el default sólo resuelve período y empresa. **Alternativa:** incluir estructura. **Por qué:** el issue autoriza empresa o paquete, y `SegmentoAnalisis` no está ligado a una estructura; aplicar una estructura sería arbitrario.

## Dónde el issue no alcanzaba

- El contrato original no decía cómo indicar el período en el GET.
- No explicitaba qué versión append-only prevalece ni cómo desempatar el ranking; se usa fecha descendente y luego nombre.
- Docker Desktop no estaba iniciado, por lo que `test:integration` y `test:db` no pudieron correr localmente; `docker compose up -d postgres redis` falló porque no existía el pipe `dockerDesktopLinuxEngine`.
- La suite completa tuvo un timeout aislado en `tests/http/admin-stats.test.ts`; el archivo repetido solo pasó 2/2 sin cambios.

## Qué quedó afuera

- Derivar rotación desde ventas y stock promedio valorizado, expresamente fuera de alcance en #428.
- Las suites con base local, bloqueadas por Docker Desktop apagado; deben quedar cubiertas por CI.

## Con qué se verifica

```bash
npm run prisma:generate                  # verde
npm run lint                             # verde
npm run typecheck                        # verde
npm run test                             # 1962/1963; timeout aislado ajeno en admin-stats
npm run test -- --run tests/http/admin-stats.test.ts  # 2/2 verde
npm run test:http                        # 199/199 verde
npm run check:openapi                    # verde
npm run typecheck:openapi-consumer       # verde
npm run check:tests-base                 # verde
docker compose up -d postgres redis      # no ejecutado: Docker Desktop apagado
```
