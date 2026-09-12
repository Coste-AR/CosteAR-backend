# 0015 — Proyectar resultados en la unidad de gestión

- **Fecha:** 2026-09-11
- **Estado:** Aceptada
- **Decide:** Santiago, en el issue #322
- **Contexto de origen:** issues #252 y #326

## Contexto

Las cantidades producidas y vendidas alimentan el motor en la unidad base, pero
los consumidores de la API necesitan leer costos unitarios y cantidades en la
unidad de gestión elegida por cada empresa. El tablero ya hacía esta conversión
en su servicio; cálculo y comparación no la hacían. Replicar la aritmética en
cada endpoint permite aplicar el factor dos veces o en sentidos distintos.

## Decisión

- `productionQuantity` y `salesQuantity` se persisten en unidad base.
- Los snapshots del motor y las alertas conservan esa unidad base.
- Una única abstracción de dominio convierte importes por unidad multiplicando
  por el factor y cantidades dividiendo por el factor.
- Cada respuesta declara `unidadGestion: { codigo, nombre, factor } | null`.
  Si no hay declaración, los valores se conservan en base y la unidad es `null`;
  nunca se infiere una unidad por rubro.

## Alternativas descartadas

| Alternativa | Por qué no |
| --- | --- |
| Guardar cantidades en unidad de gestión | Cambiar de envase cambiaría el significado histórico de los datos. |
| Convertir dentro de cada endpoint | Duplica una regla monetaria y hace posible una doble conversión. |
| Inferir la unidad desde el rubro | Produce un valor plausible aunque la empresa nunca haya declarado su unidad. |
| Persistir snapshots ya convertidos | Mezcla el resultado estable del motor con una preferencia de presentación que puede cambiar. |

## Consecuencias

El tablero conserva sus cifras actuales, cálculo y comparación exponen la misma
unidad y los resultados históricos siguen siendo interpretables en base. Los
consumidores deben revisar `unidadGestion` antes de rotular un valor.
