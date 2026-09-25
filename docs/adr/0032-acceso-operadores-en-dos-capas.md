# ADR 0032 — Acceso de operadores en dos capas

## Estado

Aceptado — 2026-09-25.

## Contexto

Una persona puede trabajar para una empresa, tener acceso a una orden o depósito
concreto y, aun así, no estar autorizada a ejecutar todas las acciones sobre esa
entidad. `OperatorDeposito` ya expresaba el primer límite, pero no había una
matriz de capacidades ni un alcance equivalente para órdenes. Además, las
políticas RLS originales solo reconocían al dueño de la empresa.

## Decisión

El acceso de `EMPRESA_OPERATOR` requiere simultáneamente:

1. una asignación explícita a la entidad (`OperatorOrdenTrabajo` u
   `OperatorDeposito`); y
2. un permiso funcional explícito en `OperatorMembership.permisos`.

El paquete declara el catálogo permitido, pero cada membresía comienza con el
arreglo vacío. La ausencia niega acceso. La aplicación verifica la capacidad y
RLS verifica el alcance de lectura con el rol real de la aplicación. Las
escrituras conservan como `userId` al dueño del tenant; el actor humano sigue
viajando separado en la auditoría.

Los campos futuros `precio`, `precioContractual` y `margen*` se filtran en el
borde HTTP cuando falta `ordenes.ver_margen`, sin fabricar ceros. El modelo no
adelanta esos importes antes de que los issues de presupuesto e informe definan
su fuente.

## Alternativas descartadas

- Usar solo roles de login: no distingue compras, planta y administración
  dentro de la misma empresa.
- Usar solo la asignación por entidad: permitiría cerrar o ver margen a toda
  persona asignada.
- Guardar una columna booleana por permiso: acopla cada capacidad futura a una
  migración y duplica el catálogo del paquete.
- Cambiar el tenant de la fila al operador: el dueño dejaría de ver movimientos
  creados por su propio equipo y se rompería el aislamiento histórico.

## Consecuencias

- Una membresía sin permisos o sin entidad asignada recibe 403 o una colección
  vacía, según el contrato de la ruta.
- Agregar una capacidad exige declararla en el paquete y validarla en el borde
  que la consume.
- `empresa_connections` permite lectura al operador de su propia membresía,
  pero mantiene toda escritura reservada al dueño.

Constitución §2, §4, §5 y §9.
