# Bitácora — issue #190: clasificación semilla por rubro

## Decisión y fundamento

La semilla propone únicamente `comportamiento_materia_prima = VARIABLE` y la
marca `confirmado = false`. Los presupuestos técnicos de producción de huevos
ubican alimento y empaque entre los costos variables; son consumos que siguen
el volumen producido.

No se propone una clasificación para mano de obra directa ni para costos
indirectos. La mano de obra puede ser fija o variable según la organización y
la remuneración. Los indirectos mezclan, entre otros, energía variable y
depreciación fija. Tratar cualquiera de esos rubros agregados como fijo o
variable por default ocultaría justo la decisión que el onboarding debe pedir.

Fuentes consultadas para la propuesta: presupuesto de postura de Penn State
Extension y guía de presupuestos de Oklahoma State University Extension.

## Supuesto explícito

Una propuesta de sistema no es una clasificación confirmada por una persona.
La restricción de base permite que una fila no confirmada tenga comportamiento
sin `clasificadoPorUserId` ni `clasificadoEn`; al confirmar desde la aplicación,
el servicio completa ambos campos con el actor autenticado y el reloj de
servidor. Esto evita atribuir falsamente la propuesta al dueño de la empresa.

## Alcance deliberadamente fuera

No se cambió el motor de absorción ni se agregó la pantalla de onboarding. La
semilla no pisa filas existentes y, en particular, nunca modifica una decisión
confirmada.

## Verificación

- `npm ci --force`
- `npm run prisma:generate`
- `npm run lint`
- `npm run typecheck`
- `npm test -- tests/domain/comportamiento-semilla.test.ts tests/application/parametros-costeo-service.test.ts --run --reporter=dot` — 13 tests verdes.
- `npm run test:integration -- --reporter=dot` — 3 archivos, 15 tests verdes,
  con rol de aplicación sin `BYPASSRLS`.
