---
issue: 372
repo: CosteAR-backend
pr: 381
rama: feat/372-tramo-semifijo
agente: codex
modelo: gpt-5
tanda: B2
inicio: 2026-09-15T20:03-03:00
fin: 2026-09-15T20:33-03:00
minutos: 30
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 2
rebotes_de_guarda: 1
---

# 2026-09-15 — Los costos semifijos ya se pueden separar sin vaciar el tablero

## Qué se hizo

- Se agregó `TramoSemifijo`, aislado por empresa y versionado: cada corrección conserva la fila
  anterior y escribe su bitácora en la misma transacción.
- Se implementaron los cuatro métodos pedidos: puntos extremos, correlación, dispersión gráfica y
  separación declarada. La API calcula una vista previa antes de guardar y conserva los pares
  `(volumen, importe)` que justifican el resultado.
- La suma fija + variable se valida contra el importe al centavo. Si no coincide, devuelve 422 con
  un mensaje accionable y no ajusta el dato en silencio.
- La contribución marginal, el total fijo y el punto de equilibrio consumen las porciones cuando
  la separación explica un único balde agregado. El fixture AM-01 da `cm = 256`.
- Se abrió `CosteAR-frontend#182` para la pantalla que consume este contrato.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** aplicar un tramo al balde MP/MOD/CIP solo si la cascada resuelve un único
  concepto semifijo y sus porciones coinciden con el importe vigente.
  **Qué otra opción había:** prorratear varios conceptos o escalar una separación histórica.
  **Por qué elegí esta:** el motor todavía entrega un importe agregado y no conserva identidad de
  concepto; cualquier reparto sería inventado. Constitución §2 y §9. Documentado en ADR 0022.
- **Qué decidí:** `DISPERSION_GRAFICA` y `DECLARADO` requieren porciones elegidas por la persona;
  puntos extremos y correlación las calculan. La dispersión exige al menos dos observaciones.
  **Qué otra opción había:** derivar una recta automática también para dispersión.
  **Por qué elegí esta:** AM3 define la dispersión como inspección visual; automatizarla la
  convertiría en correlación con otro nombre.
- **Qué decidí:** la vista previa y el guardado llaman la misma función pura.
  **Qué otra opción había:** calcular en frontend y validar otra vez en backend.
  **Por qué elegí esta:** evita dos matemáticas divergentes y mantiene la unidad con el valor.
- **Qué decidí:** las correcciones son append-only con reemplazo lógico.
  **Qué otra opción había:** actualizar la fila vigente.
  **Por qué elegí esta:** DOM-01 y la auditabilidad de las decisiones históricas.

## Dónde el issue no alcanzaba

- No definía el contrato HTTP para calcular antes de guardar. Se agregaron endpoints de preview,
  lectura y guardado bajo el `ConceptoCosteo`.
- No decía qué hacer cuando hay varios conceptos del mismo elemento pero el motor solo devuelve
  un total. Se eligió ausencia declarada: el tablero queda incompleto hasta contar con identidad o
  importes por concepto.
- No especificaba cómo obtener la porción vigente de un ajuste lineal. Se toma la ordenada al
  origen como fijo y `importe vigente - fijo` como variable; ambos deben ser no negativos.
- La tarea mezcla backend y pantalla, pero esta sesión y el issue pertenecen a backend. La pantalla
  quedó separada en el issue de frontend #182.

## Qué quedó afuera

- La pantalla de frontend: `CosteAR-frontend#182`.
- La identidad de conceptos de `IndirectCostConfig` hasta la salida del motor. No hace falta para
  el caso seguro de un único concepto; será necesaria para desagregar varios sin inventar reparto.

## Con qué se verifica

```bash
npm run prisma:generate                         # verde
npm run prisma:migrate -- tramo-semifijo        # migración aditiva; 3 derivas estructurales conocidas filtradas
npm run lint                                    # verde
npm run typecheck                               # verde
npm run check:tests-base                        # verde
npm test                                        # 1744 passed, 4 skipped
npm run test:http                               # 125 passed
npm run test:integration                        # 75 passed, rol sin BYPASSRLS
npm run test:db                                 # 66 passed
npm run check:openapi                           # verde
npm run typecheck:openapi-consumer              # verde
git diff --check                                # verde
```

La migración se generó contra la base local aislada `costear_f957`: la base compartida del
contenedor tenía historial de otra worktree y la guarda de Prisma impidió mezclarlo. El primer
`test:db` rebotó por falta de claves RSA locales; se repitió con claves efímeras en memoria, sin
escribir secretos, y quedó verde.
