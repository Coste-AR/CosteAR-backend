---
issue: 474
repo: CosteAR-backend
pr: pendiente
rama: feat/inventario-devoluciones
agente: codex
modelo: gpt-5
tanda: C1
inicio: 2026-09-25T20:58-03:00
fin: 2026-09-25T21:15-03:00
minutos: 17
tokens: no-informado
clears: 0
intentos_hasta_verde: 3
rojos_deliberados: 3
rebotes_de_guarda: 0
---

# 2026-09-25 — Devoluciones y transferencias de inventario

## Qué se hizo

- `DEVOLUCION` referencia una salida, controla la cantidad disponible y recompone stock al costo
  de esa salida o al PPP vigente según la política configurable de la empresa.
- `TRANSFERENCIA` acredita la orden de la salida y debita exactamente el mismo importe a una orden
  destino distinta, sin cambiar el stock físico.
- Las importaciones con identidad externa y hash de documento son idempotentes por empresa.
- El fixture FX-OT verifica devolución de 5 unidades por 5.900, MP neta de 89.500, saldo de 75
  unidades por 88.500 con PPP 1.180 y transferencia de 5 unidades por 5.900.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** una transferencia es un solo hecho con orden origen y destino. **Qué otra opción
  había:** guardar una salida y un ingreso separados. **Por qué elegí esta:** conserva la igualdad
  de importes y la auditoría en una sola transacción, sin alterar el stock (Constitución §2).
- **Qué decidí:** devolución y transferencia consumen juntas la cantidad disponible de la salida
  de origen. **Qué otra opción había:** limitar sólo las devoluciones. **Por qué elegí esta:** una
  unidad ya transferida tampoco puede volver a asignarse desde la misma salida.
- **Qué decidí:** exigir identidad externa y hash juntos y normalizar el hash hexadecimal a
  minúsculas. **Qué otra opción había:** deduplicar por el texto visible del documento. **Por qué
  elegí esta:** evita colisiones por nombres legítimamente repetidos (Constitución §2).

## Dónde el issue no alcanzaba

- No definía si las transferencias reducían la cantidad todavía derivable de una salida. Se eligió
  el control acumulado más conservador para impedir doble imputación.
- No definía si una importación repetida debía devolver conflicto o el hecho existente. Se eligió
  idempotencia: retorna el movimiento ya registrado y no agrega auditoría duplicada.
- La base compartida tenía migraciones fallidas de otro worktree; la verificación se hizo en una
  base aislada `costear_474_final`, creada para esta sesión, sin modificar ni limpiar la compartida.

## Qué quedó afuera

- Pantallas, según el límite explícito del issue.
- No se modificó `src/domain/calculations/` ni se reescribió ninguna fórmula del motor.

## Con qué se verifica

```bash
npm run lint                              # verde
npm run typecheck                         # verde
npm run test -- --maxWorkers=1            # 2.034 verdes, 4 omitidos
npm run test:http                         # 207 verdes
npm run test:integration                  # 94 verdes, rol sin BYPASSRLS
npm run test:db                           # 67 verdes, dueño + sonda RLS
npm run check:openapi                     # 70 operaciones coinciden
npm run typecheck:openapi-consumer        # verde
npm run check:tests-base                  # verde
npx prisma validate                       # schema válido
npm run db:setup                          # 108 migraciones + 313 sentencias RLS
```

La primera suite unitaria completa agotó el timeout de `admin-stats` mientras los otros 2.033
tests pasaron; aislado pasó 2/2 y la repetición completa con un worker pasó 2.034/2.034. Las dos
primeras corridas de `test:db` usaron respectivamente el rol restringido y claves RSA ausentes;
con los roles documentados y claves efímeras en memoria pasó 67/67.
