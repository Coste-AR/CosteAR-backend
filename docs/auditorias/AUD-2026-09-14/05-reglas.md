# F5 — Reglas duras R1-R35 — AUD-2026-09-14

## Limitación de partida — declarada explícitamente, no silenciada

**Esta sesión no tiene el texto completo del catálogo R1–R35.** Se conocen, por referencia indirecta a lo largo de esta auditoría (el pack de fixtures FX-AV y las conversaciones de esta tanda), el contenido de 13 de las 35: R1/R4/R7 (clasificación y cascada), R6 (amortización del plantel FIJA), R10 (coherencia de unitarios / fijos en totales, no unitarios), R13 (zona de equilibrio con clasificación incompleta), R15 (conjuntos, el prorrateo no decide), R16 (descarte con precio negativo), R21 (desvíos abiertos en tres), R24 (precio de transferencia), R29 (PE contra el techo del tramo), R33-R35 (moneda homogénea). **De R2, R3, R5, R8, R9, R11, R12, R14, R17-R20, R22, R23, R25-R28, R30-R32 no se tiene el texto en esta sesión** — incluye **R8 y R11**, que el pedido señaló específicamente como prioritarias por venir en ⚠️ en el marcador anterior. No se inventa su contenido. Quedan **NO VERIFICABLE — texto de la regla no disponible**, siguiendo GR-05 ("la ausencia de evidencia no es evidencia de permiso").

## Marcador — solo las 13 reglas con texto conocido esta sesión

| Regla | Qué exige (resumen) | Estado | Evidencia |
|---|---|---|---|
| R1 | Clasificación fijo/variable por cascada, capa 1 primero | 🟡 | `resolverComportamiento` (F2) cierra la cascada período→estructura→empresa correctamente — con test. Sin test que cubra las 4 capas completas de clasificación del clasificador de comprobantes (fuera del alcance de esta tanda). |
| R4 | La cascada no salta capas sin agotar la anterior | 🟡 | Mismo mecanismo que R1, mismo alcance de verificación. |
| R6 | Amortización del plantel es FIJA, no cambia con la producción | 🟡 | Diseño correcto en el fixture (verificado en F2 sobre `contribucion-marginal.ts`, P-08 PASA); no se verificó contra datos reales de dos períodos consecutivos vía API (M1 vs M2 de Granja no se cargó esta tanda). |
| R7 | Cascada de resolución de comportamiento sin saltos silenciosos | 🟡 | Igual que R1/R4. |
| R10 | Coherencia aritmética de unitarios; los fijos van en TOTALES, no en unitarios | ⚠️ **VIOLADA — empeoró la evidencia esta tanda** | F4: el tablero muestra "Costo fijo **por cajón**" ($0,00) — un fijo expresado en unitario, exactamente lo que R10 prohíbe, aunque en este caso el valor dé $0 por falta de clasificación. La tarjeta existe y se llama "por cajón": el día que haya un fijo real clasificado, va a aparecer ahí, partido por unidades. |
| R13 | Clasificación incompleta → zona [min,max], nunca un punto ni "incompleta" lisa cuando es parcial | 🟡 | F2: `calcularContribucionMarginal`/`calcularPuntoEquilibrio` PASAN el caso de clasificación TOTALMENTE ausente (da `incompleta:true`, nunca un punto). F4: el tablero también muestra "Incompleto" con motivos para ese mismo caso. **No verificado** el caso de clasificación PARCIAL (el que dispara la zona real `[585,4;600,0]` del fixture) — no se armó ese escenario esta tanda. |
| R15 | Prorrateo de conjuntos no se usa para decidir | ❌ | No se cargó ni un caso de conjuntos esta tanda (P-06 diferida en F3, no revisitada en F4). |
| R16 | Descarte con costo de eliminación = precio negativo, no merma de unidades | ❌ | Mismo motivo que R15. |
| R21 | Desvíos abiertos en tres (cantidad/precio/combinado) | ❌ | No verificado vía API ni pantalla esta tanda (P-10 declarado NO VERIFICADO en F3). |
| R24 | Precio de transferencia entre departamentos a costo, vista sectorial aparte | ❌ | No ejercitado — fuera del alcance de FX-AV según el propio fixture (§11, "queda como escenario aparte"). |
| R29 | PE mostrado contra el techo del tramo, nunca solo | ❌ | No se forzó el escenario en F4 (declarado NO VERIFICADO). |
| R33-R35 | Moneda homogénea | ❌ | Fuera de alcance — el propio fixture lo declara no cubierto (§11 de `fixtures-avicola.md`). |

**Marcador de las 13 conocidas:** ✅ 0 · 🟡 5 · ❌ 7 · ⚠️ 1

## Las 22 restantes (incluye R8 y R11) — NO VERIFICABLE

No se tiene el texto de la regla en esta sesión. Se listan sin marca para que quede explícito que faltan, no que se asumieron en algún estado: R2, R3, R5, **R8**, R9, **R11**, R12, R14, R17, R18, R19, R20, R22, R23, R25, R26, R27, R28, R30, R31, R32.

## Delta contra el marcador del 07-09-2026 (✅1·🟡3·❌26·⚠️5)

**No se puede calcular un delta honesto.** El marcador anterior cubre las 35; esta sesión solo pudo evaluar 13 con evidencia real, y las 22 restantes —incluidas **R8 y R11**, las que el pedido señaló como prioritarias— no tienen texto disponible para siquiera confirmar si siguen en el mismo estado. Reportar un delta numérico sobre 35 inventaría el estado de 22 reglas que no se leyeron. Lo único verificable: **R10 tiene evidencia nueva y más concreta de estar violada** (la tarjeta "fijo por cajón" en el tablero, F4) que la que probablemente sostenía el ⚠️ del 07-09 — no se puede confirmar que sea la MISMA evidencia sin el texto original del marcador anterior.

**Recomendación operativa:** la próxima auditoría necesita el texto de R1-R35 disponible desde la terminal (un archivo en el repo o accesible sin la bóveda) — repetir esta limitación cada vez es el mismo problema que describe DOC-02/DOC-04 sobre depender de un documento que nadie tiene a mano.
