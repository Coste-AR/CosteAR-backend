---
issue: 424
repo: CosteAR-backend
pr: 434
rama: feat/424-punto-indiferencia
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-23T17:37-03:00
fin: 2026-09-23T17:50-03:00
minutos: 13
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-23 — Un mismo cálculo compara fabricar, comprar o elegir equipo

## Qué se hizo

Se agregó una función pura que compara dos estructuras lineales de costos y devuelve el volumen
donde cuestan lo mismo, el costo en ese punto y el rango donde conviene cada alternativa. La misma
función cubre la decisión inversa de dejar de fabricar aplicando R25: usa sólo los costos fijos
evitables y valúa los materiales al precio de liquidación declarado.

El cálculo se publicó en `POST /companies/{companyId}/analisis/punto-indiferencia`, autenticado y
limitado a la empresa del usuario. El contrato OpenAPI acompaña cada valor con su unidad y declara
la ausencia del punto con un motivo, según Constitución §2 y §3.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** representar cada conveniencia como `{ desde, hasta }`, con `hasta: null` para un
  rango sin techo.
  **Qué otra opción había:** devolver textos libres como “por encima” y “por debajo”.
  **Por qué elegí esta:** conserva límites numéricos consumibles por frontend y evita que el cliente
  tenga que interpretar frases.
- **Qué decidí:** en `dejar_de_fabricar`, exigir `costosFijosEvitables` y
  `costoVariableUnitarioLiquidacion` sobre la estructura que hoy se fabrica.
  **Qué otra opción había:** reutilizar los costos totales y confiar en que quien llama ya los haya
  reemplazado.
  **Por qué elegí esta:** vuelve R25 visible y verificable en el contrato, en vez de dejarlo como una
  convención implícita.
- **Qué decidí:** si el cruce matemático cae bajo cero, declarar que no existe en el dominio de
  volúmenes válidos y señalar la alternativa dominante.
  **Qué otra opción había:** devolver una cantidad negativa.
  **Por qué elegí esta:** un volumen negativo no es accionable y violaría Constitución §2.

## Dónde el issue no alcanzaba

- No definía la forma exacta de las entradas HTTP ni de los rangos `convieneA`/`convieneB`; se usaron
  estructuras explícitas, nombres de alternativa y límites numéricos.
- No decía cómo transportar el precio de liquidación requerido por R25. Se agregó como campo
  obligatorio de la decisión inversa.
- No decía qué hacer con un cruce negativo ni con estructuras idénticas. Ambos casos se resuelven
  como ausencia declarada, indicando dominancia o igualdad.

## Qué quedó afuera

- La pantalla, expresamente fuera de alcance del issue.
- Persistencia de escenarios: el endpoint calcula sobre entradas explícitas y no requiere migración.

## Con qué se verifica

```bash
npm run lint                         # verde
npm run typecheck                    # verde
npm run test                         # 1.927 verdes; timeout ajeno en admin-stats
npm test -- --run tests/http/admin-stats.test.ts  # 2/2 verdes aislado
npm run test:http                    # 180/180
npm run test:integration             # 87/87 con rol sin BYPASSRLS
npm run test:db                      # 67/67
npm run check:openapi                # verde
npm run typecheck:openapi-consumer   # verde
npm run check:tests-base             # verde
```
