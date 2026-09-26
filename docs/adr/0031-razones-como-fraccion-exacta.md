# 0031 — Guardar toda razón física como fracción exacta y validar los cuadres sin redondeo

- **Fecha:** 2026-09-24
- **Estado:** Propuesta — la firman Alan y Lautaro (dominio) antes de encolar
- **Decide:** Alan + Lautaro
- **Contexto de origen:** ADR-1 del plan de remediación AUD-2026-09; auditorías AUD-2026-09-14-04a, AUD-2026-09-15-01 y AUD-2026-09-23-12; barrido `docs/auditorias/AUD-2026-09-15/08-barrido-decimales.md` (rama `auditoria/AUD-2026-09-14`)

## Contexto

Varias columnas del schema guardan **"algo sobre algo"** en un `Decimal` de escala fija. El problema es que hay razones reales del negocio que ninguna escala finita representa: `1/360` (huevo → cajón), `1/30` (huevo → maple), `1/12` (maple → cajón), una pérdida contada como `17/825` o un avance de "dos tercios". El barrido del 15-09 encontró dos familias:

- **🔴 Bloquea con error duro.** `conversionFromPrevious` (`Decimal(18,6)`) se compara en `validate-inputs.ts:240` y `:296` con tolerancia absoluta `1e-4`. `normalLossPct` (`Decimal(9,4)`) se compara con tolerancia **cero** en `process-costing.ts:226`. Un dato físicamente correcto rebota y el mes no cierra.
- **🟡 Contamina en silencio.** Los cuatro `*Avance` (`Decimal(9,4)`), `yieldPct`, `sellingCostVarPct` y `UnidadMedida.factor` se usan directo como multiplicadores. No hay error: el número queda levemente mal y nadie se entera.

El 23-09 apareció la variante más molesta. La pérdida se guarda redondeada (`0,0206`), pero la primera corrida la calcula con el valor exacto que llegó. Al reabrir y recalcular desde lo guardado, **el mismo dato da otro resultado**: casi una unidad pasa de pérdida normal a extraordinaria, y el costo unitario del departamento cambia.

El patrón bueno ya existe en el repo: `UnidadMedida.factor` guarda la razón **orientada para que sea entera** (360 huevos por cajón) y no `0,002777…`.

## Decisión

1. **Una razón física se guarda como un par de enteros `(num, den)`**, con `den > 0`, reducido por el máximo común divisor. `1/360` se guarda como `1/360`, no como decimal. El dominio opera con esa fracción de punta a punta (el mismo método que `calc_fx_av.py`, que usa `Fraction` y cierra los 36 cuadres de FX-AV).
2. **Una pérdida se guarda en unidades, no en porcentaje.** El dato primario es `normalLossUnits` (lo que se contó). El porcentaje se **deriva** para mostrarlo y nunca vuelve a entrar al cálculo. Si el usuario elige cargar un porcentaje, se guarda como fracción exacta de lo que escribió, no redondeado.
3. **Los avances de EI y EF** (`initialWip*Avance`, `finalWip*Avance`) también pasan a fracción.
4. **Política de tolerancia:**
   - Entre valores que ya son fracciones exactas, **igualdad exacta**. Sin epsilon.
   - Solo cuando interviene un valor legado en `Decimal`, la tolerancia es **la mitad de la resolución de su escala multiplicada por la magnitud del operando** (relativa, no absoluta). Un `1e-4` fijo sirve para 10 unidades y no sirve para 100.000.
   - Una validación que rebota **dice cuánto dio cada lado y con qué representación**, para que el usuario vea si es un error de su carga o de redondeo.
5. **Las razones en pesos** (margen, tasa de comercialización) no entran en esta regla: son montos relativos y se quedan como están.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Subir la escala del `Decimal` (p. ej. a `(30,15)`) | No arregla nada. `1/360` no es representable en ninguna escala finita: solo corre el error más lejos, y el día que se multiplica por cien mil unidades vuelve a aparecer |
| Tolerancia absoluta más grande (`1e-2`) | Deja pasar errores reales en lotes chicos y sigue rebotando datos correctos en lotes grandes. El problema es de escala, no de tamaño del epsilon |
| Guardar siempre el "factor entero" (360) y prohibir las razones que no son enteras | Sirve para huevo → cajón, pero no para pérdidas contadas (17/825), avances (2/3) ni conversiones como kg → huevo, que no son enteras |
| Número de punto flotante (`Float`) | Peor que `Decimal`: agrega error binario y no deja razonar sobre la precisión |

## Consecuencias

**A favor**

- El mismo dato da el mismo resultado siempre, se calcule en el momento que se calcule.
- Un cliente real con conteos físicos (roturas sobre producción) puede cerrar el mes.
- El cálculo del sistema y el de la cátedra (fracciones exactas en FX-AV) dejan de diferir en el último decimal.

**En contra / lo que aceptamos pagar**

- **Migración aditiva:** columnas nuevas `conversionNum`/`conversionDen`, `normalLossUnits` y `*AvanceNum`/`*AvanceDen`. Las `Decimal` viejas quedan por compatibilidad, se leen solo si falta la nueva y se marcan deprecadas. Nada se borra.
- La API acepta las dos formas durante la transición (`conversionFromPrevious` decimal **o** `{ num, den }`) y responde siempre las dos.
- El dominio pasa a trabajar con una aritmética de fracciones (sin librería nueva: `Decimal.js` alcanza para num/den enteros, o una clase `Razon` chica y testeada).
- Los datos ya cargados como decimal se convierten con la mejor fracción de denominador acotado (p. ej. `0,002778 → 1/360`) **con registro en la traza**, no en silencio.

**Qué se rompe si alguien la revierte sin leer esto**

- Vuelven los meses que no cierran por 0,09 de una unidad (AUD-15-01) y los recálculos que mueven unidades de normal a extraordinaria (AUD-23-12).

## Cómo se verifica que sigue vigente

- Test de dominio: pérdida `17/825` cargada, cerrar → reabrir → recalcular da **el mismo** costo unitario, al centavo, las dos veces.
- Test: conversión huevo → cajón `1/360` con 36.180 huevos transferidos cuadra exacto contra 100,5 cajones recibidos, sin tolerancia.
- Test: avance `2/3` en EF da la producción equivalente exacta de FX-AV.
- Check en CI: ninguna columna nueva de razón física en `schema.prisma` puede ser `Decimal(9,4)`; tiene que ser el par `num/den`.
