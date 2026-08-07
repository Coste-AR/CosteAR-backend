# Ground truth del corpus del clasificador — caso avícola

**Fecha:** 2026-08-07
**Rubro:** Avicultura de postura (~200.000 gallinas ponedoras), Tucumán
**Consume este archivo:** `tests/classifier/corpus-avicola.harness.test.ts`

---

## ⚠️ Qué es y qué no es este corpus

**Este corpus es una RECONSTRUCCIÓN.** El corpus original de 35 comprobantes que usó la
auditoría del 06/08/2026 no está versionado en ningún repositorio: el plan lo ubica en
`001.3 - Documentos de trabajo/001.3.1 - Arquitectura-IA/corpus-clasificador/`, una carpeta
que no existe en el clon del vault (`costear-knowledge-base`). Se verificó.

Para no dejar CL-04, CL-05 y CL-06 sin vara de medición, se reconstruyó un corpus a partir de
**los casos que el plan documenta por escrito**. La regla que se siguió:

> Un caso entra al corpus solo si el plan declara explícitamente (a) qué documento es, y
> (b) cuál es su clasificación correcta. Nada se completó por inferencia.

Lo que **sí** sale del plan, textual: los montos, la clasificación esperada, el comportamiento
medido del sistema (sección, confianza, `requiresAI`) y la causa del defecto.

Lo que **está reconstruido**: el texto post-OCR de cada comprobante. El plan describe los
documentos pero no transcribe su contenido. Los textos se redactaron con el mismo estilo que
`tests/classifier/vault-accuracy.harness.test.ts` (formato factura AFIP post-OCR) y con
proveedores, CUIT y CAE ficticios.

### Las tres consecuencias de que sea una reconstrucción

1. **Sus métricas NO son comparables contra la línea de base de la auditoría.** El plan
   reporta accuracy 67,6 % (23/34) y precisión a confianza ≥90 de 74,1 % (20/27) sobre el
   corpus original. Este corpus tiene 18 casos y está deliberadamente sesgado hacia los
   errores conocidos, así que su accuracy absoluta es **pesimista por construcción**.
   Sirve para comparar **antes vs. después de un mismo cambio**, no para citar un número de
   accuracy del producto.
2. **Puede pasar un caso acá y fallar en producción**, porque el texto real puede tener
   señales que la reconstrucción no tiene. Por eso `corpus-clasificador/reales/` sigue vacía
   y sigue siendo la deuda que cierra el hueco de verdad (ver §Pendiente).
3. **No cubre el escalamiento.** El plan reporta que hoy 4 de 6 revisiones son sobre aciertos
   y 4 de 5 documentos genuinamente ambiguos pasan derecho. Este corpus no tiene los
   documentos ambiguos que harían falta para medir ese reparto.

---

## Validación — ¿el corpus reconstruido reproduce lo que midió la auditoría?

**Sí, 7 de los 8 fallos documentados, con la sección y la confianza exactas.** Corrido el
07/08/2026 bajo el perfil **AGRO**, que es con el que se atiende al cliente hoy.

| Caso | Lo que reporta el plan | Lo que dio este corpus | |
|---|---|---|---|
| `CIP-01` | `GASTO_ADMINISTRACION` conf 97 | `GASTO_ADMINISTRACION` conf 97 | ✅ |
| `CIP-02` | `MATERIA_PRIMA` conf 97 | `MATERIA_PRIMA` conf 97 | ✅ |
| `CIP-04` | `MATERIA_PRIMA` conf 97 | `MATERIA_PRIMA` conf 97 | ✅ |
| `FLE-02` | `COSTOS_INDIRECTOS` conf 97 | `COSTOS_INDIRECTOS` conf 97 | ✅ |
| `MO-03` | `MANO_DE_OBRA` conf 99 | `MANO_DE_OBRA` conf 98 | ✅ |
| `MO-04` | `MANO_DE_OBRA` conf 99 | `MANO_DE_OBRA` conf 98 | ✅ |
| `MULTI-01` | colapsa a `MANO_DE_OBRA` | colapsa a `MANO_DE_OBRA` | ✅ |
| `GA-05` | pisado a `MANO_DE_OBRA` | clasifica **bien** (`GASTO_COMERCIALIZACION`) | ❌ no reproduce |

Y las métricas globales caen cerca de la línea de base de la auditoría, lo que es la mejor
evidencia de que la reconstrucción es fiel:

| Métrica | Auditoría (34 docs) | Este corpus bajo AGRO (18 docs) |
|---|---|---|
| Accuracy | 67,6 % | 61,1 % – 66,7 % |
| Precisión a confianza ≥90 | 74,1 % | 64,7 % – 70,6 % |
| Errores de alta confianza | 7 | 5 – 6 |

**`GA-05` es el único que no reproduce.** Para que Layer 4 lo pise a `MANO_DE_OBRA`, el
documento original tenía que disparar el ruteo de liquidación —o sea, parecer un recibo de
comisiones a un vendedor—. La reconstrucción es una factura de proveedor por comisiones, que
no lo dispara. **No se forzó el texto hasta que fallara**: fabricar un documento hasta
reproducir un bug es exactamente la invención que este corpus evita. CL-03 se verifica igual
con un test dirigido sobre el mecanismo de pisado, que es lo que su propio prompt pide.

### Dos hallazgos que salieron de validar, y que el plan no menciona

**1. El clasificador NO es determinista.** Dos corridas idénticas del mismo corpus, sin tocar
una línea de código, dieron **61,1 % y 66,7 %** de accuracy (6 y 5 errores de alta confianza).
La causa es `groq-classifier.ts:92`: `temperature: 0.05` y ningún `seed`.

> **Consecuencia para todas las correcciones CL-*:** "medí el corpus antes y después" **no
> alcanza** con una sola pasada — no distingue una mejora real del ruido del muestreo. El
> harness lo mitiga corriendo cada caso N veces y quedándose con la mayoría
> (`CORPUS_REPETICIONES`, default 1 por velocidad; usar 5 antes de declarar arreglado un caso).
>
> **La solución de fondo es hacer el clasificador reproducible** (`temperature: 0` + `seed`
> fijo), que además es lo correcto de cara al cliente: subir dos veces el mismo comprobante
> debería dar el mismo resultado. **Está fuera del alcance de las 9 correcciones CL-\*, así que
> se deja anotado y sin tocar.**

**2. El string de rubro influye en la IA por su cuenta, no solo eligiendo el perfil.**
`"Establecimiento avícola de postura"` y no pasar rubro resuelven **al mismo perfil**
(`DEFAULT`, porque el `AGRO_RE` no tiene `avícol`), y sin embargo dan resultados distintos:
en `CIP-02` el segundo acierta y el primero no. El string viaja como hint al prompt de Layer 5.

> **Consecuencia para CL-04:** no alcanza con medir el perfil nuevo. Hay que medir el par
> (perfil de keywords, string de rubro), porque el segundo mueve el resultado solo.

### La comparación de tres vías que pide CL-04 — línea de base

Corrida el 07/08/2026, **antes** de que exista el perfil `AVICULTURA`:

| Perfil | Accuracy | Precisión ≥90 | Errores de alta confianza |
|---|---|---|---|
| `AGRO` (el que se usa hoy) | 61,1 % | 64,7 % | **6** |
| `DEFAULT` | **77,8 %** | **82,4 %** | **3** |
| `AVICULTURA` (todavía = DEFAULT + hint) | 72,2 % | 76,5 % | 4 |

Casos donde los perfiles difieren:

| Caso | Esperado | AGRO | DEFAULT | AVICULTURA |
|---|---|---|---|---|
| `CIP-01` | CIP | **G-ADM** ❌ | CIP ✅ | CIP ✅ |
| `CIP-02` | CIP | **MP** ❌ | CIP ✅ | **MP** ❌ |
| `FLE-02` | MP | **CIP** ❌ | MP ✅ | MP ✅ |

**Esto confirma el hallazgo incómodo de CL-04 con datos propios: `DEFAULT` clasifica mejor que
`AGRO` en todos los casos donde difieren.** El perfil de rubro, tal como está, le resta.
Es la vara que el perfil `AVICULTURA` tiene que superar para justificar su existencia.

---

## Las reglas de la cátedra que se usan

Todas del vault Obsidian, carpeta `001.1 - Clases (Mirta)`. Se citan con archivo y línea para
que cualquiera pueda verificarlas sin confiar en este documento.

| Ref | Fuente | Regla |
|---|---|---|
| **R-MP-DIRECTA** | Clase 1, l. 58 | *"Directa: identificable con el objeto de costo (ej. algodón en una remera, madera en una mesa)"* |
| **R-MP-INDIRECTA** | Clase 1, l. 58 | *"Indirecta: no identificable en cantidad exacta o de importe mínimo (ej. hilo en una remera); pasa automáticamente a CIP"* |
| **R-MOD** | Clase 1, l. 59 | *"Directa: transforma la MP en producto final, identificable (ej. operarios que cortan, cosen, etiquetan)"* |
| **R-MOI** | Clase 1, l. 60 | *"Indirecta: no participa directamente en la transformación (ej. capataz, gerente de producción)"* |
| **R-CIP** | Clase 1, l. 64 | *"Incluye: materiales indirectos, MO indirecta, amortizaciones/depreciaciones, energía eléctrica, fuerza motriz, calefacción, mantenimiento"* |
| **R-NO-CIP** | Clase 1, l. 66 | *"Ojito: solo son CIP si son de producción; los gastos de administración, venta y financieros no son CIP"* |
| **R-CIP-COMP** | Clase 11, ll. 206-213 | Componentes de CIP: materiales indirectos; MO indirecta (*"gerente de producción, personal de limpieza, mecánicos de mantenimiento"*); energía eléctrica (iluminación y fuerza motriz); alquileres; seguros; honorarios |
| **R-IVA** | Clase 4, l. 27 | *"IVA: solo aplica si la empresa es responsable no inscripta o monotributista; si es responsable inscripta, el IVA no forma parte del costo de adquisición"* |
| **R-ADQUISICION** | Clase 4, ll. 15-18 | El costo de adquisición acumula flete y seguro hasta destino: *"Costo de nacionalización + flete carretero hasta destino (ej. Tucumán) = costo de adquisición total"* |
| **R-ELEMENTOS** | Clase 1, ll. 50-52 | Los tres elementos del costo (MP, MO, CIP) son categorías distintas |

---

## Los casos

18 casos. `medido` = el plan reporta el comportamiento observado. `requisito` = el plan declara
la regla correcta pero no reporta una medición sobre un documento concreto.

### Materia prima — el defecto es de monto, no de clasificación (CL-01)

Los tres se clasificaron **bien**. El defecto medido es que `buildLedgerDraft` tomó el total
con IVA en vez del neto. Por eso este error **no aparece en ninguna matriz de confusión**: es
invisible para todo lo que mide clasificación.

| Caso | Neto | IVA | Total | Lo que llegó al costo | Sobrecosteo | Regla |
|---|---|---|---|---|---|---|
| `MP-01` | 11.025.000 | 10,5 % | 12.182.625 | **12.182.625** | **+10,5 %** | R-IVA |
| `MP-03` | 9.870.000 | 10,5 % | 10.906.350 | **10.906.350** | **+10,5 %** | R-IVA |
| `MP-06` | 10.000.000 | 21 % | 12.100.000 | **12.100.000** | **+21,0 %** | R-IVA |

La aritmética de los tres cierra exactamente (11.025.000 × 1,105 = 12.182.625;
9.870.000 × 1,105 = 10.906.350; 10.000.000 × 1,21 = 12.100.000), lo que confirma que los
montos del plan son consistentes y que la alícuota está bien identificada en cada uno.

**El cliente es Responsable Inscripto con saldo de IVA a favor**, así que para él la respuesta
correcta es inequívocamente el neto. El caso del monotributista —donde el IVA **sí** es costo—
lo cubre CL-09, que generaliza esta decisión.

### Mano de obra — la rama UNKNOWN (CL-02)

| Caso | Puesto | Esperado | Base medida | Regla |
|---|---|---|---|---|
| `MO-03` | Veterinaria responsable de sanidad del plantel | `COSTOS_INDIRECTOS` | `MANO_DE_OBRA` conf **99**, `requiresAI:false` ❌ | R-MOI, R-CIP-COMP |
| `MO-04` | *(sin puesto declarado)* | `DESCONOCIDO` (escala) | `MANO_DE_OBRA` conf **99**, `requiresAI:false` ❌ | R-MOD + CL-02 |
| `MO-CAPATAZ` | Capataz de galpones | `COSTOS_INDIRECTOS` | `COSTOS_INDIRECTOS` conf 60, `requiresAI:true` ✅ | R-MOI |
| `MO-OPERARIO` | Operario de galpón de postura | `MANO_DE_OBRA` | `MANO_DE_OBRA` ✅ | R-MOD |

Los dos últimos son **guardas de regresión**: hoy están bien y el criterio de aceptación 4 de
CL-02 exige explícitamente no romperlos (*"no romper el camino que funciona"*).

Sobre `MO-04`: el esperado es `DESCONOCIDO` con escalamiento, no una sección concreta. La
cátedra no tiene una regla para "recibo sin puesto" porque no es una categoría contable — es
ausencia de información. La regla aplicable es la de MOD (R-MOD): la distinción depende de si
la persona transforma la MP, y sin el puesto eso no se puede determinar. El plan lo declara
sin ambigüedad: *"When the role is unknown, the correct behaviour is to escalate — never to
assert MOD."*

### Colapso de MULTIPLE y contradicción de la explicación (CL-02, CL-03)

| Caso | Esperado | Base medida | Regla |
|---|---|---|---|
| `MULTI-01` | `MULTIPLE` | Una sola línea de **$35.772.000** en `MANO_DE_OBRA` ❌ | R-ELEMENTOS |
| `GA-05` | `GASTO_COMERCIALIZACION` | `MANO_DE_OBRA`, con la explicación de la IA diciendo *"…lo que indica un gasto de comercialización"* ❌ | R-NO-CIP |

En `MULTI-01`, 12.360.000 + 11.760.000 + 11.652.000 = 35.772.000 — la suma da exactamente el
monto de la línea colapsada, lo que confirma el mecanismo: `analyzeDocument` detectó bien las
tres secciones y Layer 4 lo pisó al reportar `requiresAI:false`.

`GA-05` es además el caso testigo de **CL-03**: la sección guardada y el texto de la
explicación salieron de decisiones distintas.

### Costos indirectos — el perfil de rubro equivocado (CL-04, CL-05)

| Caso | Documento | Esperado | Base medida | Causa | Regla |
|---|---|---|---|---|---|
| `CIP-01` | Energía eléctrica de galpones, 184.500 kWh | `COSTOS_INDIRECTOS` | `GASTO_ADMINISTRACION` conf **97** ❌ | No matchea ninguna keyword; el regex es `\benergia\b` sin tilde | R-CIP, R-CIP-COMP |
| `CIP-02` | Gasoil para grupo electrógeno y calefacción | `COSTOS_INDIRECTOS` | `MATERIA_PRIMA` conf **97** ❌ | `fuelIsMP:true` en el perfil AGRO, regla escrita para tractores | R-CIP |
| `CIP-04` | Vacunas del plantel (400.000 dosis) | `COSTOS_INDIRECTOS` | `MATERIA_PRIMA` conf **97** ❌ | `'vacuna'` está en los `mpKeywords` de AGRO | R-MP-INDIRECTA, R-CIP-COMP |

**Tres de los siete errores de alta confianza de la auditoría son estos tres**, y los tres se
explican por lo mismo: el rubro avícola no existe y se lo atiende con el perfil de un
productor de soja.

Nota verificada sobre CL-04: en `industry-profile.ts:447`, el `AGRO_RE` contiene `avicultur`
pero **no** `avícol`. O sea que una empresa descripta como *"avícola"* ni siquiera cae en AGRO
— cae en `DEFAULT`. Esto confirma el requisito de CL-04 de agregar `avícol` al regex, y
explica por qué la comparación AGRO vs. DEFAULT del plan daba resultados distintos.

### Flete — costo de adquisición vs. costo indirecto (CL-06)

| Caso | Documento | Esperado | Base medida | Regla |
|---|---|---|---|---|
| `FLE-02` | *"Flete por la compra de 38 toneladas de maíz - Factura 0003-00001902"* | `MATERIA_PRIMA` | `COSTOS_INDIRECTOS` conf **97** ❌ | R-ADQUISICION |
| `FLE-01` | Flete interno entre galpones, sin referencia a compra | `COSTOS_INDIRECTOS` | `COSTOS_INDIRECTOS` ✅ | R-CIP |

Misma palabra, dos destinos. `FLE-01` es guarda de regresión (criterio de aceptación 2 de
CL-06). Agravante documentado: el hint de rubro que se le manda a la IA dice literalmente
*"flete de granos es COSTOS_INDIRECTOS"*, así que la IA obedece una instrucción equivocada —
por eso CL-06 pide arreglar el hint **primero**.

### Casos de requisito — sin base medida

Estos cuatro no tienen comportamiento medido reportado. Entran porque el plan declara la regla
correcta como requisito de CL-04/CL-06, y sin ellos esas correcciones no serían verificables.

| Caso | Documento | Esperado | Por qué está | Regla |
|---|---|---|---|---|
| `MP-MAIZ-REF` | Compra de 38 t de maíz, comprobante **0003-00001902** | `MATERIA_PRIMA` | Es el comprobante que `FLE-02` referencia. Sin él la cadena flete → compra no se puede verificar de punta a punta. El plan no dice qué documento del corpus original cumplía este rol. | R-MP-DIRECTA |
| `MP-BALANCEADO` | 80 t de alimento balanceado | `MATERIA_PRIMA` | CL-04: *"balanceado and maíz dominate the raw material"* y pide `'balanceado'` en `mpKeywords`. | R-MP-DIRECTA |
| `MP-MAPLE` | Maples de cartón para 30 huevos | `MATERIA_PRIMA` | CL-04 pide `'maple'` en `mpKeywords`. **Ver la pregunta abierta abajo.** | R-MP-DIRECTA + requisito CL-04 |
| `CIP-MANT-GALPON` | Mantenimiento de galpones de postura | `COSTOS_INDIRECTOS` | CL-04 pide `'mantenimiento de galpones'` en `cipKeywords`. | R-CIP |

---

## Preguntas abiertas — para resolver antes de cerrar CL-04

1. **¿El maple es MP directa o material indirecto?** CL-04 pide `'maple'` en `mpKeywords` y el
   corpus lo espera como `MATERIA_PRIMA`. Por R-MP-DIRECTA se defiende (es identificable con
   el objeto de costo: un maple por cada 30 huevos). Pero por R-MP-INDIRECTA podría argumentarse
   que es de importe mínimo relativo y por lo tanto CIP. **Se siguió el plan**, pero conviene
   confirmarlo con la cátedra: si la respuesta es la contraria, cambia un `expected` de este
   corpus y una keyword del perfil.
2. **Subproductos: gallina de descarte y huevo roto.** CL-04 los menciona como *"reales y
   recurrentes"* y pide aplicar las reglas de merma y recupero de la cátedra. **No hay ningún
   caso en este corpus** porque el plan no documenta ningún comprobante de subproducto ni su
   clasificación esperada. Si CL-04 va a tocar el tratamiento de recupero, hace falta definir
   antes qué se espera y agregar los casos.

---

## Pendiente — lo que este corpus no cierra

- **`corpus-clasificador/reales/` sigue vacía.** Con 5 a 10 fotos o PDFs de comprobantes
  reales de la avícola, el OCR se mide de verdad y se cierra el único hueco grande. La
  auditoría deliberadamente no sustituyó las fotos por texto sintético, que es lo correcto, y
  esta reconstrucción tampoco lo hace.
- **El corpus original de 35 documentos.** Si aparece, reemplaza a este y las métricas pasan a
  ser comparables contra la línea de base de la auditoría.
- **Los documentos genuinamente ambiguos** que harían falta para medir el reparto del
  escalamiento (§"Lo que sigue pendiente de medir" del plan).
