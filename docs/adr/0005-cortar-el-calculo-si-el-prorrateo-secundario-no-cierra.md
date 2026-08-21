# 0005 — Cortar el cálculo si el prorrateo secundario no cierra

- **Fecha:** 2026-08-20
- **Estado:** Aceptada
- **Decide:** Santiago
- **Contexto de origen:** issue #91 (H-L1), auditoría del motor de cálculo

## Contexto

El prorrateo secundario transfiere el costo de los centros de SERVICIO a los centros
PRODUCTIVOS. Los servicios tienen que quedar en cero: todo su costo primario llega a algún
centro productivo, que es el que después divide por las unidades y produce el costo unitario.

El motor tenía dos formas de no transferir ese costo, y ninguna avisaba:

- **Pasada directa** (sin orden de cierre): se itera sobre las filas de reparto cargadas. Un
  centro de servicio SIN fila no se recorre nunca. Su costo primario se queda en el aire.
- **Pasada escalonada** (con `closureOrder`): se itera sobre el orden de cierre. Un servicio
  que no figura en el orden nunca cierra, su costo se queda en su propio casillero, y la
  salida —que copia únicamente los centros productivos— lo descarta.

En los dos casos el cálculo terminaba bien, sin error, con **un costo unitario más bajo que el
real**. Es el peor modo de fallar que puede tener este motor: el usuario no tiene forma de
darse cuenta, y con un cliente real en producción (§1 del CLAUDE.md) un costo unitario más bajo
es una lista de precios mal armada.

Al escribir el control apareció un segundo defecto, más viejo: `secondaryProration` guardaba en
su resultado la **referencia** del objeto del prorrateo primario y después le reasignaba los
campos. Repartir el secundario mutaba el primario del llamador. No cambiaba ningún número
mientras nadie releyera el primario —por eso nunca se notó—, pero rompe de raíz cualquier
control que compare primario contra secundario.

## Decisión

Si un centro de servicio tiene costo del prorrateo primario y no lo reparte, el cálculo **corta
con un 422 accionable** (DOM-04) que nombra al centro, en vez de seguir con un número más chico.
Además, un control de cierre verifica que Σ primario de todos los centros = Σ CIP de los
productivos después de repartir, con tolerancia de medio centavo.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Repartir el costo huérfano en partes iguales entre los productivos | Inventa un criterio de reparto que el costista no eligió. El número saldría "completo" y estaría igual de mal, pero ahora sin forma de detectarlo. |
| Dejar el costo en el centro de servicio y sumarlo al total | Contradice la metodología de la cátedra: después del secundario los servicios quedan en cero. Y el costo no llegaría a ninguna cuota por centro productivo. |
| Avisar (warning) y seguir calculando | Un warning al lado de un número mal calculado se ignora. Con plata real de por medio, o el número está bien o no hay número. |
| Poner la guarda adentro de cada pasada | Ninguna de las dos ve el problema: cada una solo recorre lo que tiene cargado. El único punto que conoce a la vez el universo de centros, su costo primario y qué método se va a usar es el despacho, en `resolveProductiveCip`. |
| Comparar el cierre con `isZero()` exacto, como `checkRawMaterialConsistency` | El reparto DIVIDE. Repartir $100 en tres da tres cuotas de 33.333…(28 dígitos) que no vuelven a sumar $100 exacto. El control cortaría cálculos correctos. |

## Consecuencias

**A favor**

- Un costo unitario más bajo por costo perdido en el secundario ya no puede salir del motor.
- El mensaje nombra al centro culpable y dice qué hacer, no al id interno (F09-4).
- El control de cierre cubre también las formas de perder costo que todavía no conocemos: si se
  escapa un peso por otro camino, salta ahí y no por un número más chico.
- El primario dejó de mutarse: ahora se puede comparar contra el secundario sin sorpresas.

**En contra / lo que aceptamos pagar**

- Una estructura ya cargada a la que le falte un reparto **deja de calcular** hasta que se
  complete. Es deliberado: antes calculaba mal.
- La tolerancia de medio centavo es un umbral elegido, no una constante del dominio. Está varios
  órdenes de magnitud por encima del residuo aritmético (~1e-25) y por debajo de cualquier
  pérdida real —un servicio que no reparte deja afuera su costo primario entero—, pero es un
  número que decidimos nosotros.

**Qué se rompe si alguien la revierte sin leer esto**

- Vuelve el error silencioso: cálculos que terminan bien con un costo unitario más bajo.
- Si alguien "simplifica" `secondaryProration` volviendo a guardar la referencia del primario en
  vez de una copia, el control de cierre empieza a cortar cálculos correctos (ve el primario ya
  inflado por el propio reparto).

## Cómo se verifica que sigue vigente

```bash
npx vitest run tests/application/hl1-secundario-no-pierde-costo.test.ts
```

Cubre las dos puertas (directa y escalonada), la fila cargada toda en cero, el caso de repartir
el fijo y olvidarse el variable, el falso positivo del reparto en tercios y la regresión de la
mutación del primario.
