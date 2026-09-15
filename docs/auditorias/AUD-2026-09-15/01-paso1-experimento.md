# PASO 1 — Experimento controlado sobre AUD-2026-09-14-04a

## Diseño

Mismo endpoint, mismo flujo (`process-setup` → `movement` → `calculate`), dos conversiones
distintas, dos departamentos mínimos ("Anterior" → "Nueva") por corrida:

- **(a)** `conversionFromPrevious = 1/50 = 0,02` — exacto en `Decimal(18,6)`.
- **(b)** `conversionFromPrevious = 1/360 = 0,00277...` — periódico, ya confirmado que falla en
  `AUD-2026-09-14-04a`.

Reproducido con `docs/auditorias/AUD-2026-09-15/evidencia/paso1-experimento.mjs`.

## Resultado

```
(a) 1/50  -> POST calculate -> 200 (CARGA)
(b) 1/360 -> POST calculate -> 422 MISSING_INPUT (FALLA)
```

**(a)** cargó sin ningún workaround: `conversionFromPrevious` se guardó `0.02` exacto, `1000 kg ×
0,02 = 20,00` bolsas, sin ningún desvío, `calculate` devolvió `200` con el árbol de derivación
completo (`costoUnitarioTotalAcumulado: 12700`, cuadre `totalToAccount = totalAccounted` en los
dos departamentos).

**(b)** repitió exactamente el mismo error que documentó `03-backend.md` de la tanda anterior:

```json
{"error":{"code":"MISSING_INPUT","message":"\"Anterior\" transfirió 3600 unidades pero en
\"Nueva\" cargaste que recibió 10. Se esperaban 10.0008 (3600 × factor 0.002778 = 10.0008).
Faltan 0.0007999999999999119 unidades..."}}
```

## Veredicto

**PROBADO: `AUD-2026-09-14-04a` es exclusivamente representabilidad del factor decimal, no una
falla general del motor de procesos.** Con un factor exacto, el motor completo —cuadro de
unidades, producción equivalente, `transferredCost`, árbol de trazabilidad— funciona sin ningún
ajuste. El fallo es puntual a `Decimal(18,6)` no pudiendo representar razones periódicas en base
10, tal como ya se había diagnosticado. No cambia la severidad de `04a` ni el camino de
remediación propuesto (razón entera en vez de multiplicador decimal); lo que cambia es la
**certeza**: antes era una reproducción única, ahora es un experimento con control negativo (b,
falla) y control positivo (a, funciona) sobre el mismo código, en la misma sesión.

**Qué habilitó esto:** con la certeza de que el motor en sí está sano, PASO 2 pudo cargar una
cadena completa de 4 períodos por API sin ningún workaround — algo que `AUD-2026-09-14` no pudo
hacer con Granja→Fraccionadora (huevo→cajón, factor periódico).
