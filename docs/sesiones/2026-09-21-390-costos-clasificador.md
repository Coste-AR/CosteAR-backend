---
issue: 390
repo: CosteAR-backend
pr: pendiente
rama: feat/390-costos-clasificador
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-21T17:04:02-03:00
fin: 2026-09-21T17:35:11-03:00
minutos: 31
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 3
rebotes_de_guarda: 0
---

# 2026-09-21 — Medimos el costo real de cada llamada del clasificador

## Qué se hizo

- Layer 5 registra proveedor, modelo, tokens nullable, latencia, costo estimado
  y moneda por cada request, incluidos retries y respuestas fallidas.
- Las métricas se vinculan a la carga sin guardar prompt ni documento y se
  insertan en la misma transacción que `DataEntry` y `ClassificationAudit`.
- El endpoint admin `GET /admin/classifier/costos?desde=&hasta=` resume por
  proveedor y moneda; separa las llamadas sin medición en vez de contarlas como
  cero y exige rol `ADMIN`.
- Se agregó migración aditiva, RLS real, contrato OpenAPI y configuración de
  precios por ambiente.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** transportar las métricas hasta la transacción de ingesta.
  **Alternativa:** persistirlas desde el cliente HTTP antes de crear la carga.
  **Por qué:** evita filas huérfanas y conserva la atomicidad (Constitución §2).
- **Qué decidí:** precio por millón de tokens con moneda obligatoria en
  `CLASSIFIER_AI_PRICING_JSON`. **Alternativa:** fijar precios/USD en código.
  **Por qué:** los precios cambian y la unidad debe viajar con el valor
  (Constitución §3).
- **Qué decidí:** el reporte admin recorre tenants bajo RLS. **Alternativa:**
  abrir una política cross-tenant para el rol de aplicación. **Por qué:** la
  ruta no justifica debilitar el aislamiento de la tabla.
- **Qué decidí:** declarar en Prisma defaults y acciones de FK ya presentes en
  la migración de #380. **Alternativa:** aceptar los `DROP/ADD` que generó la
  primera corrida. **Por qué:** eran deriva ajena y destructiva; el schema debía
  describir la base real antes de generar esta migración.

## Dónde el issue no alcanzaba

- No definía unidad del costo. Se hizo explícita y configurable; el resumen no
  mezcla monedas.
- No decía si un retry cuenta. Cuenta porque es otra request potencialmente
  facturable.
- No decía cómo consulta el admin una tabla con RLS. Se mantuvo el aislamiento y
  se agregaron los resultados por tenant.

## Qué quedó afuera

- Cobrar por uso y cambiar proveedores, tal como fija el issue.
- Configurar precios reales de producción: el código sólo define el contrato;
  cada ambiente debe cargar su tabla vigente.
- #389 quedó bloqueado y comentado porque no define el catálogo de widgets; no
  se inventaron claves, etiquetas ni defaults.

## Con qué se verifica

```bash
npm run lint                         # verde
npm run typecheck                    # verde
npm run build                        # verde
npm test -- --maxWorkers=1           # 1.870 verdes, 4 skipped existentes
npm run test:http -- --maxWorkers=1  # 147 verdes
npm run test:integration -- --maxWorkers=1 # 84 verdes, rol NOBYPASSRLS
npm run test:db -- --maxWorkers=1    # 66 verdes
npm run check:tests-base             # verde
npm run check:openapi                # 29 operaciones, verde
npm run typecheck:openapi-consumer   # verde
git diff --check                     # verde
```

La primera verificación paralela tuvo timeouts por contención en
`admin-stats` y `whatsapp-webhook-verify`; ambos pasaron en la corrida serial
completa sin cambiar límites. La base compartida tenía deriva de otros
worktrees, por lo que la migración y suites con base se verificaron en una base
local desechable nueva, sin borrar ni resetear datos.
