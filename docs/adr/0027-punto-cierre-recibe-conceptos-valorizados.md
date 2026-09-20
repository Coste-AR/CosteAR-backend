# 0027 — El punto de cierre recibe conceptos valorizados y no reparte baldes agregados

- **Fecha:** 2026-09-20
- **Estado:** Propuesta
- **Decide:** Codex, para revisión de Santiago
- **Contexto de origen:** issue #378, M3-03, plan de análisis marginal v2 §8.4

## Contexto

M3-03 reemplaza `CF → CFE` y `cv → cve` en toda la familia de fórmulas de equilibrio. El modelo
`ConceptoCosteo` ya declara `erogable` y `horizonteErogableMeses`, pero no guarda un importe. El
motor de absorción llega a `calculation-result-enrichment.ts` con MP, MOD y CIP agregados: perdió
la identidad y el importe de cada concepto. ADR 0021 dejó explícitamente ese límite.

Usar esos baldes agregados para el punto de cierre exigiría repartir, por ejemplo, un CIP entre
energía, alquiler y amortización sin evidencia. Eso contradice Constitución §2: ausencia declarada,
nunca un valor inventado.

## Decisión

La capa de dominio de M3-03 recibe **conceptos ya valorizados**. Cada entrada lleva clave, etiqueta,
comportamiento, erogabilidad, primer horizonte exigible y el importe compatible con su naturaleza:
importe fijo, importe variable unitario, o ambas porciones si es semifijo.

`resolverPerfilErogable` calcula para cada horizonte:

- `CFE`: suma de porciones fijas erogables cuyo horizonte ya fue alcanzado;
- `cve`: suma de porciones variables unitarias bajo la misma regla;
- `cmf = precio − cve`, razón de contribución y marcación financiera;
- conceptos incluidos y excluidos, sin perder la traza.

`calcularFormulaPuntoCierre` aplica esos valores a las catorce variantes entregadas por M3-01. La
mezcla multiproducto exige sus contribuciones financieras por producto: si faltan, devuelve ausencia.
`calcularPuntosCierre` conserva cada horizonte pedido como una respuesta separada y publica los dos
textos doctrinarios para que un consumidor no tenga que recrearlos.

Un concepto valorizado con `erogable = null`, o erogable sin horizonte, hace que la respuesta sea
`null` con motivo. No se interpreta como no erogable. Los valores viajan con unidad en el formulario
existente y el horizonte viaja en meses (Constitución §3). Los criterios se escribieron en rojo antes
del módulo (Constitución §5).

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Repartir MP/MOD/CIP agregados según la cantidad de conceptos | La cantidad de filas no prueba la proporción económica; inventaría importes. |
| Agregar un importe a `ConceptoCosteo` | El issue no pide schema ni define vigencia, moneda, unidad o versionado del importe. Sería una migración y un modelo de datos nuevos fuera de alcance. |
| Tratar `erogable = null` como `false` | Convierte una ausencia en cero silencioso y puede bajar artificialmente el punto de cierre. |
| Devolver un único horizonte por default | Oculta la diferencia obligatoria entre 1 y 12 meses y hace que el llamador adivine política. |

## Consecuencias

- La matemática financiera queda pura, reusable y probada sin tocar el motor de absorción.
- AM-01 da 375 unidades a 1 mes y 593,75 a 12 meses; entre 593,75 y 750 informa que pierde
  económicamente y sostiene la caja.
- Un endpoint o pantalla futura debe aportar conceptos valorizados desde una fuente que conserve su
  identidad. Este PR no afirma que el balde agregado sea ese desglose.
- No hay migración, mutación, query ni cambio de los resultados históricos.

## Verificación

`tests/domain/punto-cierre.test.ts` cubre los dos horizontes, las catorce fórmulas de M3-01, el caso
multiproducto y la ausencia de erogabilidad/horizonte. Los fixtures existentes del motor permanecen
sin cambios.
