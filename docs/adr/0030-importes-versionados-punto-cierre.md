# ADR 0030 — Importes nominales versionados para el punto de cierre

## Estado

Aceptado — 2026-09-22, issue #403.

## Contexto

`ConceptoCosteo` clasifica causalidad, erogabilidad y horizonte, pero no guarda valores. El cálculo puro de M3-03 recibe conceptos ya valorizados; usar MP/MOD/CIP agregados repartiría importes sin evidencia y violaría Constitución §2.

## Decisión

- Guardar cada declaración en `ConceptoCosteoImporte`, separada de la clasificación. La tabla admite porción fija, variable unitaria o ambas según el comportamiento del concepto.
- Cada corrección inserta otra fila con `vigenteDesde`; las filas publicadas son inmutables mediante trigger. La versión aplicable es la última cuya vigencia no supera `vigenteEn`.
- Moneda y unidad viajan con cada importe. Esta entrega es nominal: no homogeneiza moneda. Una mezcla de monedas o unidades produce ausencia explícita.
- El endpoint devuelve `importeVersionIds`, los insumos y los conceptos incluidos/excluidos. Eso hace reproducible la respuesta con las filas inmutables utilizadas.
- Un concepto resuelto sin clasificación completa o sin la porción que exige su comportamiento deja el resultado ausente y nombra el concepto; nunca cae al balde agregado.
- La escritura queda reservada a `EMPRESA_ADMIN`; lectura y escritura siguen el tenant propietario y RLS.

## Alternativas descartadas

- **Columnas sobre `ConceptoCosteo`:** mezclaría clasificación y valores, y una corrección pisaría historia o duplicaría toda la clasificación.
- **Repartir MP/MOD/CIP:** no existe evidencia para asignar el agregado entre conceptos.
- **Convertir moneda aquí:** pertenece al contrato de moneda homogénea; este endpoint declara `nominal: true`.

## Consecuencias

La pantalla puede pedir horizontes independientes y explicar ausencias. El caller declara precio unitario, equilibrio económico y actividad porque #403 no define un período/cálculo canónico del cual leerlos; la API devuelve esos insumos sin alterarlos y toda la matemática del punto de cierre permanece en el dominio.
