# Bitácora — issue #193: alerta por movimiento del punto de equilibrio

## Decisión y supuesto explícito

El indicador es la variación porcentual absoluta entre el punto de equilibrio
de la corrida nueva y el de la corrida inmediatamente anterior de la misma
estructura. Se usa valor absoluto porque una suba y una baja pueden requerir
revisión; la alerta avisa del movimiento y no califica su conveniencia.

Se eligió **10 %** como referencia inicial editable en
`umbral_variacion_punto_equilibrio_pct`. Es una decisión del equipo para
habilitar la regla por defecto, no un dato confirmado de ningún cliente. El
valor sigue la cascada empresa → estructura → período y se marca sin confirmar
hasta que alguien lo defina explícitamente.

La regla por estructura se crea o sincroniza cuando hay una corrida; usa el
mecanismo existente de `ReglaAlerta` y su evaluador. No se cambió el motor de
alertas ni se inventó otro canal de entrega.

## Fuera de alcance

No se modificó la infraestructura genérica de alertas, sus rutas, canales ni
la interfaz. Tampoco se agregaron reglas para otros indicadores.

## Verificación

- `npm ci`
- `node node_modules/prisma/build/index.js generate`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/eslint/bin/eslint.js ... --max-warnings 0`
- Tests focalizados de dominio y aplicación — 36 verdes.
- Integración con rol de aplicación y RLS — 3 verdes, incluyendo umbral
  superado y no superado.
