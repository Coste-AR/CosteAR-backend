# Reporte de efectividad del clasificador vs. criterios de la cátedra (Mirta)

> **TL;DR** — Se validó el motor de clasificación (`classifyDocument`, el mismo
> que usa el Portal de Operador) contra los criterios de clasificación de costos
> del vault "Clases (Mirta)". Baseline **79.3%** → **100% en casos core** (53/53)
> tras 3 fixes deterministas. Se agregó un harness de regresión versionado y se
> documentaron 6 divergencias conocidas cátedra↔sistema para decidir en equipo.
>
> **Branch:** `AlanSandbox` · **Suite:** 219 passed / 1 skipped · **typecheck:** OK

---

## 1. Qué se hizo y por qué

El Portal de Operador toma lo que el operador manda (texto o foto de un
comprobante) y lo pasa por `classifyDocument`
(`src/application/empresa/empresa-portal-service.ts` → Step 6). El motor devuelve
una **sección de costo** (`MATERIA_PRIMA | MANO_DE_OBRA | COSTOS_INDIRECTOS |
VENTAS | DESCONOCIDO`).

El objetivo fue medir qué tan seguido esa sección coincide con el criterio
contable de la cátedra (vault Obsidian `001 - Costear / 001.1 - Clases (Mirta)`,
Clase 1 — Clasificación de costos) y llevar la efectividad a ≥90% sin romper nada.

### Criterio contable usado como verdad de oro

| Sección | Definición (Clase 1) |
|---|---|
| `MATERIA_PRIMA` | Insumo que se **consume en producción**, identificable con el objeto de costo (MP directa). |
| `MANO_DE_OBRA` | Recibos / liquidaciones / horas del personal que **transforma la MP** (MOD). |
| `COSTOS_INDIRECTOS` | Todo lo de **producción** que no es MP ni MOD directa: alquiler de planta, energía, seguro, mantenimiento, limpieza, flete, notas déb/créd, **MP indirecta y MO indirecta**. |
| `VENTAS` | Factura de venta emitida / remito de salida. |
| `DESCONOCIDO` | No se puede auto-clasificar con seguridad → **escala a revisión humana** (no es error silencioso). |

> **Ojo (criterio de cátedra):** los gastos de **administración,
> comercialización y financieros NO son costos** de producción — son *gastos*.
> Hoy el sistema no tiene una sección para ellos (ver §5, gaps 3-5).

---

## 2. Cómo correr el harness

```bash
cd Costear.api
npx vitest run tests/classifier/vault-accuracy.harness.test.ts --reporter=basic
```

Archivo: **`tests/classifier/vault-accuracy.harness.test.ts`**. Corre como parte
de la suite normal (`npm test`). Tiene 2 `it`:

- **CORE** — mide accuracy por sección y total. **Falla si baja de 90%** (gate).
- **GAP** — reporta divergencias conocidas cátedra↔sistema. Es **informativo**,
  no rompe el build.

El dataset son "cargos" tipo post-OCR (lo que el clasificador ve realmente).
Cada caso lleva `kind: 'core' | 'gap'`, `industry` (rubro), `text` y la sección
`expected` derivada del vault. Para agregar casos, sumá objetos al array `CASES`.

---

## 3. Cambios de código (3 fixes)

Todos deterministas, sin tocar la IA. Los 3 hacen la clasificación **más
correcta** respecto del vault y del uso real.

### Fix 1 — Facturas de VENTA se contabilizaban como COMPRA de Materia Prima
**Archivo:** `src/infrastructure/classifier/signals/definitive-signals.config.ts`

`CAE_FOUND` mapeaba **siempre** a `FACTURA_COMPRA`. Pero una factura de venta
**también** lleva CAE → la venta caía en `routeFacturaCompra` y terminaba en
`MATERIA_PRIMA` (ej.: "vendí 200 piezas" → MP). Error contable de fondo.

- Nueva señal `FACTURA_VENTA_CTX` (conf 98) que requiere marcadores
  **inequívocos** de venta: `factura [B] de venta`, `venta a cliente`,
  `vendimos`, `nota de venta`.
- `CAE_FOUND` ahora tiene `excludeIfPattern` con esos mismos marcadores.
- **No** se keyea en `cliente` ni `punto de venta`: aparecen también en facturas
  de **compra** (en una compra, nuestra empresa figura como "Cliente" del
  proveedor, y todas las facturas AFIP tienen "Punto de Venta").

### Fix 2 — Keywords de CIP frágiles (frases multi-palabra)
**Archivo:** `src/infrastructure/classifier/layers/layer4-business-routing.ts`

Los `cipKeywords` del perfil son frases exactas que se rompen con un "de"/"y" en
el medio: `seguro maquinaria` no matchea `seguro **de** maquinaria`;
`mantenimiento máquina de coser` no matchea `mantenimiento **y reparación**
máquina...`. Resultado: escalaban a revisión sin necesidad.

- Nueva constante `UNIVERSAL_CIP_KEYWORDS` (mantenimiento, reparación, seguro,
  póliza, alquiler, limpieza, vigilancia, seguridad, flete, logística,
  amortización, depreciación, telefonía, internet, expensas, vtv, residuos):
  conceptos que son CIP en **cualquier rubro** (criterio de cátedra).
- Se puntean **además** de los `cipKeywords` del perfil (dedup con `Set`).

### Fix 3 — Notas de débito/crédito con CAE se leían como factura de compra
**Archivo:** `definitive-signals.config.ts` (+ test en `tests/classifier/layer1.test.ts`)

Una nota de débito real **también lleva CAE**. Como `CAE_FOUND` (97) le ganaba a
`NOTA_DEBITO_ABC` (96), la nota se tipificaba como `FACTURA_COMPRA` y la regla
`nota → CIP` de Layer 4 casi nunca disparaba.

- `NOTA_DEBITO_ABC` y `NOTA_CREDITO_ABC` subidos a **conf 98** (> CAE 97).
  `NOTA DE DÉBITO A` es más específico que un CAE suelto.
- Test de regresión agregado: una nota con CAE se tipifica como nota, no factura.

---

## 4. Resultados (dataset actual: 53 core + 8 gap)

```
── Accuracy por sección (CORE) ──
  MP    21/21 (100%)
  MOD    7/7  (100%)
  CIP   20/20 (100%)
  VTA    5/5  (100%)
==> CORE ACCURACY: 53/53 = 100.0%  |  auto-clasificados: 100.0%
```

Cobertura del dataset core por rubro: Agro, Gastronomía, Manufactura, Textil,
Construcción, Salud, Transporte, Comercio. Tipos de documento: factura de compra,
factura de venta, recibo/liquidación, planilla de horas, nota de débito/crédito,
remito de entrada y de salida.

> **Aclaración honesta:** el 100% es sobre **documentos formales** (con marcador
> AFIP: CAE / `FACTURA A/B` / `RECIBO DE SUELDO`). El motor es *document-type-first*:
> si no reconoce el tipo de documento, no rutea sección. El **texto informal**
> ("compramos fertilizante", sin estructura de factura) depende de la IA (Layer 5)
> — ver §6.

---

## 5. Divergencias conocidas cátedra ↔ sistema (bloque GAP)

No cuentan en la métrica; se listan para decidir en equipo. `escala-OK` = el
sistema manda a revisión humana (comportamiento seguro). `diverge` = auto-clasifica
distinto al criterio de cátedra (a revisar).

| # | Caso | Cátedra dice | Sistema hace | Comentario |
|---|---|---|---|---|
| 1 | Hilo de coser (remera) | CIP (MP indirecta) | MP | Debatible: el hilo puede ser MP directa si es insumo principal. **No se forzó.** |
| 2 | Capataz / supervisor de planta | CIP (MO indirecta) | MOD | El sistema ve "RECIBO DE SUELDO" y va a MOD. La MO indirecta debería ir a CIP. |
| 3 | Honorarios del contador | GASTO admin (no costo) | escala-OK | Escala; ideal sería una sección `GASTOS`. |
| 4 | Sueldo gerente administrativo | GASTO admin (no costo) | MOD | Recibo → MOD. Debería no ser costo de producción. |
| 5 | Publicidad / marketing | GASTO comercial (no costo) | escala-OK | Escala; ideal `GASTOS`. |
| 6 | Intereses de préstamo bancario | GASTO financiero (no costo) | CIP | Nota de débito → CIP. Debería no ser costo. |
| 7 | Alquiler de **hormigonera** | CIP | escala (???) | Colisión de substring: "hormigon**era**" matchea keyword `hormigón` (MP). |
| 8 | Rubro con acento ("gastronómica") | — | detección de rubro frágil | `categorizeIndustry` es sensible a acentos. |

---

## 6. Recomendaciones para el equipo

Ordenadas por impacto:

1. **Cargar un `GROQ_API_KEY` válido en cada entorno.** Hoy en local el default es
   el placeholder `groq_placeholder`, y `GroqService.isConfigured` sólo chequea
   `length > 10` (`src/infrastructure/ai/groq-service.ts:161`) → el placeholder
   **pasa** e igual hace llamadas reales que fallan con *"Invalid API Key"*. Efecto:
   la IA (Layer 5) está muerta y **todo el texto informal escala a revisión**.
   → **Endurecer `isConfigured`** para rechazar el placeholder explícitamente.

2. **Definir política para gastos NO-costo** (admin, comercialización, financieros).
   Hoy no hay sección para ellos (gaps 3-6). Opciones: (a) nueva sección
   `GASTOS_NO_COSTO`, o (b) forzar `requiresReview` con una etiqueta clara. El
   criterio de cátedra es explícito: **no son costos de producción**.

3. **MO indirecta → CIP** (gap 2). Un recibo de capataz/supervisor/gerente de
   producción es CIP, no MOD. Requiere detectar rol en el recibo (keywords:
   `capataz`, `supervisor`, `jefe de planta`, `gerente`) y rutear a CIP.

4. **Robustez de keywords** (gaps 7-8):
   - Matchear `cipKeywords`/`mpKeywords` por **límite de palabra**, no `includes`,
     para evitar colisiones tipo `hormigonera`↔`hormigón`.
   - **Normalizar acentos** en `categorizeIndustry` antes de testear los patrones
     de rubro (`gastronómica` debe matchear `gastronom`).

5. **Extender el dataset** a medida que aparezcan casos reales del piloto. El
   harness está pensado para crecer: sumá objetos a `CASES` con su `expected`
   según el vault y el gate de 90% te avisa si algo regresiona.

---

## 7. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/infrastructure/classifier/signals/definitive-signals.config.ts` | Señal `FACTURA_VENTA_CTX`; `excludeIfPattern` en `CAE_FOUND`; notas déb/créd a conf 98. |
| `src/infrastructure/classifier/layers/layer4-business-routing.ts` | `UNIVERSAL_CIP_KEYWORDS` + scoring combinado en `routeFacturaCompra`. |
| `tests/classifier/layer1.test.ts` | Assert 96→98 + test de regresión nota-con-CAE. |
| `tests/classifier/vault-accuracy.harness.test.ts` | **Nuevo** — harness + dataset (53 core, 8 gap) con gate ≥90%. |
| `docs/clasificador-efectividad-vault.md` | **Nuevo** — este reporte. |
