# 0026 — La moneda homogénea usa snapshots completos y explícitos

- **Fecha:** 2026-09-20
- **Estado:** Propuesta
- **Decide:** Codex, para revisión de Santiago
- **Contexto de origen:** issue #374, M11-01, Constitución §2/§3 y reglas R33–R35

## Contexto

La ficha PPP auditada promediaba precios nominales de períodos distintos. La
decisión del issue fija una serie mensual por empresa, carga manual por su dueño,
fuente descriptiva y correcciones append-only. También exige que un hueco quede
nominal y que una corrida histórica conserve la versión que utilizó.

## Decisión

Cada empresa tiene una sola `PriceIndexSeries`. Su fuente y período base —el
momento cero— quedan fijos al crearla. Cada guardado crea una
`PriceIndexSeriesVersion` nueva y completa: los valores no modificados se copian
desde el snapshot anterior y las correcciones se aplican sólo al nuevo. Cada
cálculo que efectivamente homogeneiza persiste el id de esa versión.

Los períodos económicos de la existencia inicial y de cada compra son datos
explícitos. No se deducen de la posición, del rubro ni de una fecha ambigua. La
capa nueva reexpresa esos precios antes de llamar al PPP auditado; no modifica
`raw-material.ts`.

Si falta el índice de destino, el de una compra o el período económico de un
precio, no se mezclan pesos homogéneos con nominales: toda la ficha conserva los
valores históricos y responde `NOMINAL` con la lista de ausencias. Las
comparaciones entre períodos siguen el mismo criterio y, cuando están completas,
reexpresan el período viejo al índice del período nuevo.

R33 se calcula sin redondear como `(1 + tn) / (1 + ti) - 1`. Con 8 % y 5 %
mensuales, el factor compuesto de doce meses es `1,4022`. El `1,4034` escrito en
el criterio del issue no se reproduce con esa fórmula; se conserva la regla
doctrinaria exacta y se declara la discrepancia.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Corregir una fila mensual con `UPDATE` | Cambiaría retrospectivamente las corridas que dicen usar esa serie. |
| Versionar sólo el valor corregido | Obliga a reconstruir una versión mezclando historia y hace ambigua la referencia persistida por el cálculo. |
| Reexpresar lo disponible y dejar nominal sólo el hueco | El PPP resultante mezclaría poderes adquisitivos y parecería comparable sin serlo. |
| Inferir el período desde `date` | Los formatos históricos admiten fechas parciales y la existencia inicial puede venir de más de un mes. Viola Constitución §3. |
| Forzar `×1,4034` para igualar el texto | Contradice R33 y fabricaría una diferencia financiera sin fórmula que la sostenga. |

## Consecuencias

Las correcciones crean más filas, pero cada snapshot es auditable y autocontenido.
Los clientes viejos siguen calculando exactamente igual: sin períodos e índices
explícitos reciben importes nominales y una marca, nunca un valor inventado. La
API de comparación declara moneda, índice destino, versión y períodos faltantes.

## Verificación

AM-10 cubre tasa real, reexpresión previa al PPP y fallback nominal. Hay pruebas
HTTP para la carga, integración con Postgres real para versionado/RLS y pruebas
de comparación para moneda homogénea y huecos.
