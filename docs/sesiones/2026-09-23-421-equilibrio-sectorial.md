---
issue: 421
repo: CosteAR-backend
pr: 431
rama: feat/421-equilibrio-sectorial
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-23T14:31:00-03:00
fin: 2026-09-23T14:58:19-03:00
minutos: 27
tokens: no-informado
clears: 0
intentos_hasta_verde: 4
rojos_deliberados: 1
rebotes_de_guarda: 1
---

# 2026-09-23 — Cada sector muestra cuánto aporta y qué fijos cubre

## Qué se hizo

Se agregó el modelo jerárquico `SegmentoAnalisis`, su CRUD HTTP auditado y aislado por RLS, y el
cálculo de equilibrio específico y sectorial. La respuesta presenta juntas la vista sin prorrateo
y la vista auxiliar con prorrateo, marcada `doctrinaria: false`, más el control de que las
contribuciones netas cubran exactamente los indirectos comunes.

El fixture AM-02 cierra en 2.000 unidades y reproduce los resultados netos -4.000, 6.000 y 10.000.
La producción conjunta no admite costo variable propio (R15): usa los precios de sus coproductos
ponderados por rendimiento, incluido un desecho con precio negativo.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** guardar por segmento la participación, precio, costo variable, fijo directo y
  porción de indirectos, y declarar los coproductos como una lista de nombre, precio y rendimiento.
  **Qué otra opción había:** inferir esas magnitudes desde ventas y conceptos existentes.
  **Por qué elegí esta:** la pregunta B del plan sobre qué niveles pueblan el árbol sigue abierta;
  inferirlos habría inventado una política. Se aplicaron Constitución §2 (ausencia declarada), §3
  (cada valor conserva su significado) y §9 (lo no definido no se inventa).

- **Qué decidí:** conservar la vista sin prorrateo como doctrinaria y rotular la prorrateada como
  auxiliar con su motivo.
  **Qué otra opción había:** devolver solo el resultado prorrateado.
  **Por qué elegí esta:** evita que una asignación común parezca causal y aplica la regla explícita
  del issue junto con Constitución §1 (la respuesta debe permitir decidir sin una auditoría mental).

- **Qué decidí:** empresas sin segmentos reciben una colección vacía y equilibrio general ausente.
  **Qué otra opción había:** fabricar un segmento empresa implícito.
  **Por qué elegí esta:** mantiene el comportamiento histórico y aplica Constitución §2.

- **Qué decidí:** las mutaciones usan borrado lógico y escriben `TraceAuditLog` en la misma
  transacción.
  **Qué otra opción había:** borrado físico o auditoría posterior.
  **Por qué elegí esta:** cumple DOM-01/DOM-02 y conserva trazabilidad recuperable.

## Dónde el issue no alcanzaba

- No definía los campos exactos del CRUD ni la fuente automática de la jerarquía. El plan nombra
  `VentaProducto.canal` y `variante`, pero mantiene abierta la decisión sobre niveles adicionales;
  por eso el CRUD queda explícito y el poblado automático no se implementó.
- No definía cómo persistir el prorrateo. Se modeló como importe común asignado por segmento para
  que el control AM-02 sea auditable y no dependa de una base implícita.
- No definía el formato de coproductos. Se usó precio por rendimiento y se permite precio negativo
  para representar el costo de eliminación sin inventar otra categoría.

## Qué quedó afuera

- La pantalla de equilibrio sectorial.
- El poblado automático de segmentos desde ventas.
- Relaciones de reemplazo, recurso escaso, precio de transferencia y rotación, que corresponden a
  tareas posteriores del plan.

## Con qué se verifica

```bash
npm run lint                         # verde
npm run typecheck                    # verde
npm run test                         # 1.909 verdes; 4 skipped
npm run test:http                    # 170 verdes
npm run test:integration             # 87 verdes
npm run test:db                      # 67 verdes
npm run check:openapi                # verde; 47 operaciones tipadas
npm run typecheck:openapi-consumer   # verde
npm run check:tests-base             # verde
```

Antes del verde, el test de dominio falló porque el módulo todavía no existía. La guarda estática
de RLS también frenó una corrida al detectar que `SegmentoAnalisis` todavía no estaba declarado en
`RLS_MODELS`; se corrigió antes de ejecutar las suites con PostgreSQL real.
