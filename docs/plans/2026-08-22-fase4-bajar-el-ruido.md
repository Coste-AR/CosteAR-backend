# Fase 4 — Bajar el ruido

> Plan escrito **antes** de implementar. Sale del §11.4 de la auditoría consolidada, Fase 4.
> Estado previo: Fase 0 ✅ · Fase 1 ✅ · Fase 2 ✅ (todas el 22-08).

## El principio

> **Un semáforo que se ignora es peor que no tenerlo.**

Nada de lo de abajo rompe nada hoy. Todo enseña a desconfiar de la señal, y esa desconfianza es la
que después deja pasar el problema de verdad.

## Hallazgo 1 — La suite unitaria le pega a la base de datos

### Lo medido

`tests/classifier/cascade-section-decision.test.ts` **falla en la máquina de un dev y pasa en el
CI**. Es el espejo exacto del error del 21-08 (un test que pasaba en local y no cargaba en el CI).

| Medición | Valor |
|---|---|
| Cada llamada a `classifyDocument()` | **~4.100 ms** |
| Llamadas a la base en la suite unitaria completa | **22**, todas de `correction-memory.ts` |
| Costo total del ruido | **~88 segundos por corrida** en cualquier máquina sin Docker |
| El test que falla | Hace 4 llamadas → 16s contra un límite de 5s |

### La causa

`classifyDocument()` llama a `getCorrectionExamples()`, que hace
`prisma.classificationAudit.findMany()` para darle ejemplos a la IA. **El fallo es no-fatal por
diseño** (try/catch → `undefined`), y eso es correcto.

Lo que no es correcto es el precio del fallo:

| Dónde | `DATABASE_URL` | Qué pasa | Costo |
|---|---|---|---|
| CI unitario | no existe | Prisma falla al validar, al instante | ~0 ms |
| Máquina de un dev sin Docker | `localhost:5433` | **espera el timeout de conexión** | **~4.100 ms** |

Por eso el CI está verde y la máquina del dev en rojo: **no es el mismo fallo, es el mismo fallo a
distinta velocidad.**

### Por qué importa más de lo que parece

Existe `npm run check:tests-base`, un guard que detecta tests que **necesitan** base y no están en
ninguna suite. Este caso **no lo cubre**: el test no necesita base —funciona igual sin ella— pero
**la toca**. Un test así no falla: tarda. Y lo que tarda de más termina fallando por timeout en la
máquina más cargada, que es donde nadie lo va a poder reproducir.

### El arreglo

Mockear `correction-memory` en los tests unitarios que llaman a `classifyDocument()`, igual que ya
se mockea Layer 5.

**No cambia lo que se prueba**: hoy esas llamadas ya devuelven `undefined`, porque la base no está.
Lo único que se saca es la espera.

**Alternativas descartadas:**

| Alternativa | Por qué no |
|---|---|
| Subirle el timeout al test | Trata el síntoma. Los 88 segundos siguen ahí, y el próximo test que sume una llamada vuelve a romper |
| Un alias global en `vitest.config.ts` | Invisible: quien escriba un test *de* `correction-memory` recibiría el stub sin saberlo |
| Que `getCorrectionExamples` no consulte si no hay base | Cambiar código de producción para acomodar a los tests. La función está bien como está |

## Hallazgo 2 — 20 warnings de lint preexistentes

Todos de la misma regla, `@typescript-eslint/no-explicit-any`, concentrados en pocos archivos:

| Archivo | Warnings |
|---|---|
| `infrastructure/database/prisma.ts` | 7 |
| `application/validaciones/cost-structure-populator.ts` | 3 |
| `application/costista-chat/costista-chat-service.ts` | 2 |
| `application/empresa/whatsapp-webhook-service.ts` | 2 |
| `http/routes/system-alert.routes.ts` | 2 |
| otros cuatro archivos | 1 c/u |

Van en un **PR aparte**: tipar de verdad esos `any` toca código de producción y merece su propia
revisión. Mezclarlo con el arreglo de los tests haría un PR que nadie revisa (PR-03).

## Criterios de cierre

- [ ] La suite unitaria no produce **ninguna** llamada a la base
- [ ] `cascade-section-decision.test.ts` pasa en una máquina sin Docker
- [ ] La suite completa baja de forma medible
- [ ] Los 20 warnings, en su propio PR
