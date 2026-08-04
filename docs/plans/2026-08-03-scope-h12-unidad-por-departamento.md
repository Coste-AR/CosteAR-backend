---
title: "Scoping de H12 — unidad de medida por departamento + conversión entre etapas"
fecha: 2026-08-03
origen: "HALLAZGOS.md (auditoría 03/08 sobre staging), consecuencia directa del arreglo de H2"
estado: "Sin implementar — dimensionamiento para decidir prioridad"
---

# H12 — unidad de medida por departamento

## El límite tal cual está hoy

El chequeo que cerró H2 (`validate-inputs.ts:234-249`) exige que las unidades
que un departamento transfiere sean **exactamente** las que el siguiente recibe.
Es correcto — sin esa igualdad la plata se evapora en silencio, que era
exactamente H2 — pero asume que los dos departamentos miden **la misma unidad
física**. La tabla `process_departments` no tiene ninguna columna de unidad: no
hay dónde declarar que Molienda mide en toneladas y Destilado en litros.

Consecuencia: una cadena real de citrícola o ingenio (toneladas de fruta →
litros de jugo → kilos de concentrado) no se puede cargar. Antes de H2 el
sistema aceptaba el mismo número en las dos unidades y perdía plata sin avisar;
después de H2 corta con un 422. Cortar es mejor que mentir, pero el caso de uso
sigue sin poder cargarse — por eso las claves de prueba P01-P05 usan una sola
unidad en toda la cadena a propósito (es una simplificación consciente para
probar el motor, documentada en `HALLAZGOS.md`).

El propio código ya lo anticipa (`validate-inputs.ts:229-233`):

> "Convertir unidades es una funcionalidad a construir, no una validación a
> ablandar."

## Dónde vive el problema, exactamente

Rastreé el flujo completo. La buena noticia: el desajuste de unidades **solo
importa en un lugar**. En todo el resto del sistema, cada departamento opera
sobre sus propios números sin cruzarlos con los de al lado:

- El motor (`process-costing.ts`) calcula cada departamento de forma
  independiente — MP/MOD/CIF, pérdidas, producción equivalente — todo dentro de
  la unidad propia de ese departamento.
- El arrastre entre períodos (B18) transfiere **plata** (`initialWipCostPrevDept`),
  no unidades físicas — no necesita conversión.
- El único cruce entre departamentos es el chequeo de H2: comparar
  `transferredOut` del departamento N contra `receivedFromPrevious` del N+1
  (`validate-inputs.ts:234-249`, probado en
  `tests/application/unidades-entre-departamentos.test.ts`).

Eso acota la solución a un cambio quirúrgico, no una reescritura del motor.

## Diseño propuesto

**1. Dato nuevo, por departamento:** `unit: string | null` (texto libre —
"toneladas", "litros", "kg" — no un enum cerrado: la cátedra no fija un
vocabulario único de unidades y forzar uno excluiría casos legítimos) y
`conversionFromPrevious: Decimal | null` (cuántas unidades del departamento
actual produce cada unidad recibida del anterior; ej. 1 tonelada de fruta →
550 litros de jugo → `conversionFromPrevious = 550`). Los dos nulos por
default: departamentos existentes (P01-P05 y las 4 estructuras de H13) siguen
comparando 1:1, exactamente como hoy. **No rompe nada retroactivamente.**

**2. El chequeo de H2 pasa de igualdad a igualdad-con-factor:**

```
recibidas ≈ transferidas × conversionFromPrevious   (factor 1 si no está cargado)
```

Mismo mensaje de error, misma tolerancia (1e-4), un factor de más en la cuenta.

**3. Dónde se carga el factor — la pregunta que falta cerrar.** Dos opciones,
no técnicamente equivalentes:

- **(a) Estructural, en el setup previo** (`ProcessSetupService.complete()`,
  junto a `name`/`sequence` de cada departamento). Simple, una vez, coherente
  con que la cadena productiva es fija. Pero un rendimiento real varía por
  cosecha/lote — un coeficiente fijo puede quedar desactualizado.
- **(b) Editable por período, como `yieldPct` en costos conjuntos** (que ya es
  un `DataPoint` versionado, no un dato estructural). Más fiel a cómo la
  cátedra trata el rendimiento técnico, pero es más superficie: un campo más en
  el cuadro de movimiento, un `DataPoint` más para trazar.

Para una primera versión recomiendo **(a) con posibilidad de override** — el
setup fija un valor por defecto, y si hace falta ajustarlo período a período se
agrega después como (b). Pero esto es un criterio de producto/cátedra, no algo
que deba decidir yo solo: **vale la pena que Mirta lo confirme junto con la
pregunta del subproducto que ya está pendiente.**

## Qué archivos toca (backend)

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | 2 columnas nullables en `process_departments`: `unit`, `conversionFromPrevious` |
| nueva migración | `ALTER TABLE process_departments ADD COLUMN...` — no destructiva |
| `src/domain/periods/setup-rules.ts` | `SetupDepartment` suma `unit?`, `conversionFromPrevious?`; `validateSetup` valida factor > 0 si viene cargado |
| `src/application/cost-structures/process-costing/process-setup-service.ts` | `complete()` persiste los dos campos nuevos al crear/actualizar el departamento |
| `src/application/cost-structures/validate-inputs.ts:234-249` | el chequeo cruzado usa el factor en vez de exigir igualdad |
| `tests/application/unidades-entre-departamentos.test.ts` | casos nuevos: factor cargado y cuenta, factor ausente (default 1, comportamiento actual intacto) |
| `tests/domain/setup-rules.test.ts` | validación del factor nuevo |

## Qué archivos toca (frontend)

| Archivo | Cambio |
|---|---|
| `ProcessSetupWizard.tsx` / `DepartmentsTab.tsx` | campo de unidad (texto) + factor de conversión por departamento (excepto el primero, que no recibe de nadie) |
| `UnitMovementTab.tsx` | mostrar la unidad del departamento junto a los campos de unidades (cosmético, no bloqueante) |
| `process-costing-types.ts` | los dos campos nuevos en `ProcessDepartment` |

## Tamaño

Backend: media jornada (migración + dominio + validación + tests). Frontend:
media jornada (dos campos en el wizard + labels). **Total: 1 día, no un
proyecto largo** — la razón por la que HALLAZGOS.md lo marcó "grande" es que es
una *feature* (falta un dato que hoy no existe en ningún lado), no un ajuste de
una función ya escrita, no por volumen de código.

## Lo que no incluye esta primera versión

- Catálogo cerrado de unidades ni conversión automática entre unidades
  "conocidas" (kg↔ton, l↔ml): el factor lo tipea el costista, el sistema no
  sabe de física.
- Ajustar el factor período a período (opción (b) de arriba) — se agrega
  después si hace falta.
- Migrar retroactivamente las estructuras existentes: no hace falta, el
  default (factor 1, sin unidad) reproduce el comportamiento actual.

## Antes de implementar

Una sola pregunta abierta bloquea empezar con confianza: **¿el coeficiente de
conversión es estructural (fijo en el setup) o varía por período?** Si la
respuesta es "varía", el diseño (b) cambia dónde vive el dato y qué se traza —
mejor saberlo antes de escribir la migración que después.
