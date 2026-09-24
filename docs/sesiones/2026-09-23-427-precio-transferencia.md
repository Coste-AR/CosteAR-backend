---
issue: 427
repo: CosteAR-backend
pr: 438
rama: feat/427-precio-transferencia
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-23T20:37-03:00
fin: 2026-09-23T20:57-03:00
minutos: 20
tokens: no-informado
clears: 0
intentos_hasta_verde: 4
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-23 — Dos precios internos, dos preguntas distintas

## Qué se hizo

Se modelaron los precios de transferencia por período, origen, destino, concepto y criterio, con
migración aditiva y aislamiento RLS. El nuevo endpoint publica juntos el equilibrio a costo
variable y el equilibrio a mercado. Si alguien pide usar mercado para una decisión marginal, la
API conserva el criterio de costo variable y explica el ajuste.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** tratar `PrecioTransferencia.valor` como el importe unitario que se suma al costo
  variable del segmento destino y conservar la unidad junto a los tres resultados.
- **Qué otra opción había:** persistir cantidades físicas transferidas y derivar el importe dentro
  del endpoint.
- **Por qué elegí esta:** el modelo prescripto por §7.6 sólo define `valor`; agregar cantidad habría
  ampliado el modelo y el alcance. Constitución §3 exige que la unidad viaje con el valor.

- **Qué decidí:** resolver el endpoint contra el período más reciente de la empresa.
- **Qué otra opción había:** agregar un `periodId` al contrato HTTP.
- **Por qué elegí esta:** el contrato cerrado del issue no declara parámetros; sumar uno habría
  cambiado el contrato pedido.

## Dónde el issue no alcanzaba

El issue no define cómo se cargan los precios, qué período elige un GET sin parámetros ni si
`valor` es unitario o total. Se eligió la interpretación mínima compatible con el modelo del plan
y se dejó explícita en las decisiones anteriores.

## Qué quedó afuera

- La pantalla, expresamente fuera de alcance.
- Un CRUD de precios de transferencia: el issue sólo pide el modelo y el contrato de lectura.

## Con qué se verifica

```bash
npm run lint                         # verde
npm run typecheck                    # verde
npm run test                         # 1.942 verdes, 4 omitidos
npm run test:http                    # 188 verdes
npm run test:integration             # 87 verdes, RLS real
npm run test:db                      # 67 verdes
npm run check:openapi                # verde
npm run typecheck:openapi-consumer   # verde
npm run check:tests-base             # verde
```

La primera corrida global tuvo el timeout aislado conocido de `admin-stats`; el archivo pasó 2/2
solo y la repetición completa quedó verde. La primera corrida de `test:db` carecía de claves RSA
locales; se generaron claves efímeras y la suite quedó verde sin modificar configuración del repo.
