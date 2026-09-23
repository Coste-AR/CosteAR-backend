---
issue: 425
repo: CosteAR-backend
pr: 436
rama: feat/425-relacion-reemplazo
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-23T18:36-03:00
fin: 2026-09-23T18:54-03:00
minutos: 18
tokens: no-informado
clears: 0
intentos_hasta_verde: 4
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-23 — Reemplazar una línea muestra el corto y el largo plazo

## Qué se hizo

Se agregó el cálculo de relación de reemplazo entre dos segmentos de análisis. La API recibe los
segmentos de origen y destino, la cantidad que cae y el resultado buscado; devuelve la relación,
la compensación necesaria y los dos extremos de la línea destino: corto plazo con la estructura
del origen todavía vigente, y largo plazo después de desmantelarla.

El contrato publica los dos horizontes juntos, conserva la unidad declarada en cada cantidad y
declara ausencia cuando la contribución marginal del destino no permite dividir. AM-03 queda
cubierto con relación 2,00; 50 unidades de origen; 100 de destino; 1.900 a corto plazo y 900 a
largo plazo.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** la petición identifica segmentos persistidos por ID; el servicio obtiene de
  ellos las contribuciones marginales y los costos fijos directos, y suma el prorrateo de todos
  los segmentos activos como costo fijo indirecto de la empresa.
- **Qué otra opción había:** aceptar todos esos importes libres en el body, desconectados de
  `SegmentoAnalisis`.
- **Por qué elegí esta:** el issue pide calcular sobre los segmentos de M4-01. Mantener una sola
  fuente evita que el cliente mande números incompatibles con el análisis sectorial.

- **Qué decidí:** la función pura devuelve `null` y un motivo cuando la contribución marginal del
  destino no es positiva.
- **Qué otra opción había:** responder infinito, forzar cero o dejar que la serialización falle.
- **Por qué elegí esta:** aplica Constitución §2 (ausencia declarada) y la regla del plan para
  denominadores no positivos.

- **Qué decidí:** cada cantidad lleva la unidad declarada por el consumidor.
- **Qué otra opción había:** inferirla del nombre del segmento.
- **Por qué elegí esta:** aplica Constitución §3; `SegmentoAnalisis` todavía no persiste una unidad.

- **Qué decidí:** el contrato se prueba también con una respuesta incompleta, a la que le falta
  el horizonte largo.
- **Qué otra opción había:** comprobar únicamente los valores del camino verde.
- **Por qué elegí esta:** el criterio de aceptación exige que una respuesta de un solo horizonte
  falle y Constitución §5 pide rojo antes que verde.

## Dónde el issue no alcanzaba

El issue fijaba la respuesta pero no el body. Se asumió que los importes propios de cada línea
salen de `SegmentoAnalisis`, que `resultadoObjetivo` es opcional con valor cero y que los costos
fijos indirectos son la suma de `prorrateoIndirectos` de los segmentos activos de la empresa.

La primera corrida global encontró un timeout aislado en `admin-stats`, ajeno al cambio: pasó 2/2
al correr el archivo solo y la repetición global terminó con 1.933 pruebas verdes. La primera
corrida de `test:db` usó la clave JWT de muestra de `.env.example`; con claves efímeras generadas
en memoria pasó 67/67.

## Qué quedó afuera

- Pantalla, expresamente fuera de alcance del issue.
- Persistir una unidad en `SegmentoAnalisis`; el contrato actual no la define y agregarla habría
  requerido ampliar schema y alcance.
- No hubo bajas ni renombres de tests.

## Con qué se verifica

```bash
npm run lint                         # verde
npm run typecheck                    # verde
npm run test                         # 1.933 verdes, 4 skipped
npm run test:http                    # 183 verdes
npm run test:integration             # 87 verdes con rol sin BYPASSRLS
npm run test:db                      # 67 verdes
npm run check:openapi                # verde, 51 operaciones tipadas
npm run typecheck:openapi-consumer   # verde
npm run check:tests-base             # verde
```
