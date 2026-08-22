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

**2. ~~El string de rubro influye en la IA por su cuenta, no solo eligiendo el perfil.~~**
**RETRACTADO el 09/08/2026 al hacer CL-04. Era falso, y el hallazgo real es el 1.**

Lo que decía este punto: `"Establecimiento avícola de postura"` y no pasar rubro resolvían al
mismo perfil (`DEFAULT`) y sin embargo daban distinto en `CIP-02`, de donde se concluía que el
string viajaba como hint al prompt de Layer 5.

Se verificó **en el código** y no es así. `input.industry` se usa en **un solo lugar** de todo
el backend: `cascade-classifier.ts:230`, `categorizeIndustry(input.industry)`. Lo que se le pasa
a Layer 5 es `industryProfile.label` y la categoría, nunca el string crudo
(`cascade-classifier.ts:448` → `groq-classifier.ts:29-30`). Verificable con
`grep -rn "input.industry" src`. Dos strings que resuelven a la misma categoría producen un
prompt **idéntico byte por byte**.

O sea que aquella diferencia en `CIP-02` era el hallazgo 1 disfrazado: **ruido de muestreo**
(`temperature: 0.05` sin `seed`), medido con una sola repetición. Es exactamente el error que
el hallazgo 1 advierte que se comete, y se cometió acá.

> **Consecuencia para CL-04:** alcanza con medir el perfil; el par (perfil, string) no existe
> como variable independiente. Y —más importante— **cualquier string que resuelva a la
> categoría X sirve para medir el perfil X**, que es lo que permite que la fila `AGRO` del
> harness siga midiendo AGRO ahora que ningún string avícola cae ahí (ver abajo).

### La comparación de tres vías

#### (a) Línea de base — 07/08/2026, antes de que existiera el perfil `AVICULTURA`

Con la IA en el circuito y `CORPUS_REPETICIONES=1`:

| Perfil | Accuracy | Precisión ≥90 | Errores de alta confianza |
|---|---|---|---|
| `AGRO` (el que se usaba) | 61,1 % | 64,7 % | **6** |
| `DEFAULT` | **77,8 %** | **82,4 %** | **3** |
| `AVICULTURA` (todavía = DEFAULT) | 72,2 % | 76,5 % | 4 |

| Caso | Esperado | AGRO | DEFAULT | AVICULTURA |
|---|---|---|---|---|
| `CIP-01` | CIP | **G-ADM** ❌ | CIP ✅ | CIP ✅ |
| `CIP-02` | CIP | **MP** ❌ | CIP ✅ | **MP** ❌ |
| `FLE-02` | MP | **CIP** ❌ | MP ✅ | MP ✅ |

**El hallazgo incómodo, con datos propios: `DEFAULT` clasificaba mejor que `AGRO`.** El perfil
de rubro, tal como estaba, le restaba. Es la vara que `AVICULTURA` tenía que superar.
(La fila `AVICULTURA` de esta tabla no medía ningún perfil nuevo: medía `DEFAULT` otra vez, y
su diferencia en `CIP-02` era el ruido de muestreo del hallazgo 2 retractado.)

#### (b) Después de CL-04 — 09/08/2026

| Perfil | Accuracy | Precisión ≥90 | Errores de alta confianza |
|---|---|---|---|
| `AGRO` | 61,1 % (11/18) | 81,8 % (9/11) | **2** |
| `DEFAULT` | 72,2 % (13/18) | 100 % (11/11) | 0 |
| **`AVICULTURA`** | **83,3 % (15/18)** | **100 % (13/13)** | **0** |

Casos donde los perfiles difieren:

| Caso | Esperado | AGRO | DEFAULT | AVICULTURA |
|---|---|---|---|---|
| `MP-06` (núcleo vitamínico) | MP | **???** ❌ | MP ✅ | MP ✅ |
| `CIP-02` (gasoil de generador) | CIP | **MP** ❌ | **???** ❌ | CIP ✅ |
| `CIP-04` (vacunas del plantel) | CIP | **MP** ❌ | **???** ❌ | CIP ✅ |
| `MP-MAPLE` (maples de cartón) | MP | **???** ❌ | MP ✅ | MP ✅ |

**`AVICULTURA` le gana a los dos.** En accuracy es directo. En precisión a ≥90 empata con
`DEFAULT` en 100 %, pero **con más denominador**: 13/13 contra 11/11. Eso no es un empate, es
lo que se buscaba — `CIP-02` y `CIP-04` dejan de ser un escalamiento (`DEFAULT`) o un error de
alta confianza (`AGRO`) y pasan a ser una respuesta correcta afirmada por regla. Los dos
errores de alta confianza que le quedan a `AGRO` son justamente esos dos.

Los tres casos que `AVICULTURA` todavía falla no son suyos: `MO-03` y `MULTI-01` son de CL-02 y
`FLE-02` es de CL-06, y los tres están declarados en `FALLOS_CONOCIDOS`.

#### ⚠️ Las dos tablas NO son comparables entre sí. Tres motivos, todos medidos

1. **(b) se corrió SIN la IA** (`GROQ_API_KEY=` vacío → Layer 5 devuelve `null` y la cascada
   decide por reglas). No fue una decisión metodológica sino una restricción: el 09/08/2026 la
   cuota compartida de Groq estaba agotada y el rate-limiter reportaba pedidos de espera de
   475 s, 344 s y 228 s recortados a 60 s. Una pasada de tres perfiles × 18 casos × 3
   repeticiones no terminaba, y dejarla corriendo bloqueaba a los demás.
2. **A cambio, (b) es determinista y gratis**: 0 casos inestables, corre en 1,8 s, y mide
   exactamente lo que CL-04 cambió, que es el ruteo por keywords de Layer 4. Se reproduce con:
   `GROQ_API_KEY= CORPUS=1 CORPUS_PERFILES=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/classifier/corpus-avicola.harness.test.ts`
   (`npx vitest` a secas **no** carga `.env`, así que corre sin IA *y* sin base — ojo con eso).
3. **Entre (a) y (b) aterrizó CL-05**, que le dio a `UNIVERSAL_CIP_KEYWORDS` las keywords de
   electricidad y arregló el `\benergia\b` sin tilde. Por eso `CIP-01` ya no aparece entre los
   casos que difieren: lo resuelven bien **los tres** perfiles, sin mérito de CL-04.

**Lo que falta para cerrar del todo:** rehacer (b) con la IA en el circuito y
`CORPUS_REPETICIONES=3` cuando la cuota de Groq se recupere. No se espera que cambie el
veredicto —bajo `AVICULTURA` los tres casos que decidían (`CIP-02`, `CIP-04`, `MP-06`) los
resuelve Layer 4 con `requiresAI:false`, o sea que la IA ni los ve— pero sí puede mover
`FLE-02` y `MULTI-01`, que dependen de ella.

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

Nota verificada sobre CL-04 (estado **anterior**): el `AGRO_RE` contenía `avicultur` pero **no**
`avícol`. O sea que una empresa descripta como *"avícola"* ni siquiera caía en AGRO — caía en
`DEFAULT`. Eso confirmaba el requisito de CL-04 de agregar `avícol` al regex.

**Resuelto el 09/08/2026, y con más alcance que el pedido.** No alcanzaba con agregar `avícol`:
`AGRO_RE` también matchea `agro`, `campo`, `ganad` y `avicultur`, así que un cliente que se
describiera como *"establecimiento agropecuario avícola"* o *"avicultura de postura"* **seguía
cayendo en AGRO**, que es el defecto que había que sacar de circulación. La detección quedó así:

- `AVICOLA_RE` se evalúa **antes** que `AGRO_RE` y cubre `av[íi]col`, `avicultur`, `ponedora`,
  `gallina`, `granja de huevos`, `producción de huevos`, `postura de huevos`.
- `AVICOLA_NO_RE` la contrapesa: `frigoríf`, `matadero`, `faena`, `distribuidor`,
  `comercializadora`, `mayorista`, `minorista`. Una *"frigorífico avícola"* es una planta de
  faena (su MP es el ave, no el balanceado) y una *"distribuidora avícola"* revende; mandarlas a
  `AVICULTURA` sería repetir el error de CL-04 en la dirección contraria. Caen en `MANUFACTURA`
  y `COMERCIO`.
- `avicultur` **salió** de `AGRO_RE`.

Consecuencia para el harness: ningún string avícola resuelve ya a `AGRO`, así que la fila `AGRO`
de la comparación usa `'Productora agropecuaria'`. Es equivalente por lo dicho en el hallazgo 2
retractado — el string solo elige la categoría y nunca llega al prompt.

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

## Preguntas abiertas — estado al cerrar CL-04

### 1. ¿El maple es MP directa o material indirecto? — SIGUE ABIERTA

CL-04 pide `'maple'` en `mpKeywords` y el corpus lo espera como `MATERIA_PRIMA`. Por
R-MP-DIRECTA se defiende (es identificable con el objeto de costo: un maple por cada 30 huevos).
Pero por R-MP-INDIRECTA podría argumentarse que es de importe mínimo relativo y por lo tanto CIP.

**No se pudo resolver con las clases del vault.** Se buscó y la cátedra no trata el envase del
producto terminado como caso propio: R-MP-INDIRECTA da un criterio doble —"no identificable en
cantidad exacta **o** de importe mínimo"— y el maple cumple el primero (sí es identificable) pero
podría cumplir el segundo. Los dos ejemplos que da la cátedra (el algodón de la remera vs. el
hilo de la remera) no desempatan: el maple no se parece a ninguno de los dos.

**Se siguió el requisito de CL-04** y quedó `'maple'`/`'maples'`/`'huevera'` en `mpKeywords`,
declarado en el comentario del perfil. **Si la cátedra responde lo contrario**, el cambio es
chico y está localizado: mover esas keywords de `mpKeywords` a `cipKeywords` en
`industry-profile.ts` y cambiar el `expected` de `MP-MAPLE` en `corpus.json`.

### 2. Subproductos: gallina de descarte y huevo roto — RESUELTA A MEDIAS

Lo que **sí** se resolvió con la cátedra, y está implementado:

- **El huevo roto es una merma, y su naturaleza no se puede inferir del comprobante.** Clase 21,
  ll. 87-88: la pérdida **normal** es la que cae dentro de un *"umbral de tolerancia establecido
  por la empresa o el ingeniero (generalmente entre 1 % y 10 %)"* y **la absorben las unidades
  buenas**; la **extraordinaria** es la que lo supera y *"se valúa y va directamente al estado de
  resultados"*. Ese umbral **no está en el texto de ningún comprobante**, así que el sistema no
  puede elegir entre las dos sin preguntar. Por eso el vocabulario de merma avícola
  (`'huevo roto'`, `'huevos rotos'`, `'mortandad'`, `'gallinas muertas'`, …) entró en
  `lossKeywords`, que es la lista que `layer0a` trata como **merma de naturaleza ambigua →
  revisión humana obligatoria**. Verificado sin IA: "se descartaron 4.200 huevos rotos" escala;
  "merma normal de proceso: 1,2 %, dentro del rango habitual" **no** escala y sigue por la
  cascada al costo; "se incendió el galpón y se perdió el plantel" da `PERDIDA_INVENTARIO`.
- **La gallina de descarte NO es una merma** y deliberadamente **no** está en `lossKeywords`.
  Es el fin planificado del ciclo de postura, no una pérdida. Meterla ahí habría hecho que una
  venta normal y valiosa escalara como si fuera un siniestro.

Lo que **no** se resolvió, y por qué no se inventó una respuesta:

- **El recupero de Categoría 2 no es representable en el clasificador.** Clase 43 da dos
  tratamientos para el subproducto: **Categoría 1** (reconocer el ingreso al vender, sin tocar el
  costo del principal) y **Categoría 2** (deducir el ingreso neto del costo de producción del
  producto principal, *"la mejor opción"* cuando el ingreso es significativo). El enum
  `CostSection` **no tiene ninguna sección de recupero / reducción del costo de producción**: solo
  MP, MOD, CIP, VENTAS, los tres gastos, MULTIPLE y DESCONOCIDO. O sea que hoy el sistema solo
  puede hacer Categoría 1 (una factura de venta de gallina de descarte → `VENTAS`), y **no porque
  se haya elegido, sino porque es lo único que sabe decir**.
- **Y la elección entre Categoría 1 y 2 depende de un juicio que el comprobante no trae**: la
  cátedra la ata a si el ingreso neto es *"significativo"* o *"poco significativo"* respecto del
  producto principal. Eso es una decisión del costista sobre el negocio, no un dato del papel.
- **Además, ni la gallina de descarte encaja limpio en la definición.** Clase 43 exige que un
  subproducto *"requiera proceso adicional para poder venderse (si no hay proceso adicional, es
  desperdicio, no subproducto)"*. La gallina se vende viva al frigorífico, sin proceso adicional
  del establecimiento; pero tampoco es un desperdicio, que la cátedra define como *"sin valor de
  venta relevante"*. **La definición de la cátedra no cubre este caso.**

> **Conclusión, sin decidirla en silencio:** no se agregó ningún caso de subproducto al corpus ni
> ninguna keyword que rutee la gallina de descarte, porque hacerlo exigía inventar (a) una sección
> de recupero que el dominio del clasificador no tiene y (b) un criterio de significatividad que
> no está en el comprobante. **Esto es un hueco de modelo, no de keywords: agregar palabras no lo
> cierra.** Lo que hace falta antes de tocar nada: que la cátedra diga si la gallina de descarte
> es subproducto, desperdicio o baja de un activo amortizable — y, si es subproducto de
> Categoría 2, que se agregue al modelo la forma de expresar un recupero contra el costo.

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
