---
issue: 400
repo: CosteAR-backend
pr: 410
rama: feat/400-nombre-producto
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-21T23:07:05-03:00
fin: 2026-09-21T23:22:00-03:00
minutos: 15
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-21 — El paquete publica el nombre visible del producto

## Qué se hizo

- `PaqueteRubro` incorpora `nombreProducto` como columna nullable y el paquete
  avícola declara `AVI`.
- `GET /periods/:id/tablero-dueno` publica el dato como
  `rubro.nombreProducto`; un paquete que no lo declara devuelve `null` y 200.
- El contrato OpenAPI y los tipos del consumidor se regeneraron.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** modelar el nombre como columna nullable del paquete. **Qué
  otra opción había:** incluirlo en alguno de los JSON existentes. **Por qué
  elegí esta:** es un atributo estable de presentación del paquete, queda
  tipado por Prisma y conserva ausencia explícita para filas históricas
  (Constitución §2 y §4).
- **Qué decidí:** propagar el valor de la fila más específica incluso cuando es
  `null`. **Qué otra opción había:** heredar el valor de una fila menos
  específica. **Por qué elegí esta:** un override sin nombre declara ausencia;
  heredar silenciosamente inventaría una marca no declarada (Constitución §2).

## Dónde el issue no alcanzaba

- No indicaba si `nombreProducto` debía vivir en una columna o dentro de un
  bloque JSON. Se eligió la columna nullable por contrato y compatibilidad.
- No especificaba la semántica de cascada para un override sin nombre; se tomó
  la ausencia explícita en vez de heredar.

## Qué quedó afuera

- Nombres largos, traducciones y nombres por cliente.
- El sidebar visual, que corresponde a `CosteAR-frontend#184`.

## Con qué se verifica

```bash
npm run lint
npm run typecheck
npm run test -- --maxWorkers=1
# 217 archivos verdes, 1 skipped; 1.879 tests verdes, 4 skipped existentes
npm run test:http -- --maxWorkers=1
# 28 archivos; 153 tests verdes
npm run test:integration -- --maxWorkers=1
# 28 archivos; 85 tests verdes con rol sin BYPASSRLS
npm run test:db -- --maxWorkers=1
# 5 archivos; 66 tests verdes con sonda RLS y claves RSA efímeras
npm run check:tests-base
npm run check:openapi
npm run typecheck:openapi-consumer
# guardas y consumidor tipado verdes; 32 operaciones OpenAPI
```

Rojo deliberado: tres casos fallaron antes de implementar: faltaba `AVI`, el
contrato avícola omitía el campo y el paquete sin nombre no publicaba `null`.
El primer comando no llegó al rojo porque faltaban dependencias en el worktree;
se repitió después de `npm ci` y `npm run prisma:generate`.

La base compartida tenía deriva histórica ajena, por lo que la migración se
generó y aplicó desde cero en `costear_400`. El SQL generado incluyó una deriva
ajena sobre `user_preferences`; se retiró tras revisarlo y quedó únicamente el
`ADD COLUMN` aditivo. La primera integración usó el rol restringido para migrar
y la segunda todavía no tenía los grants sobre tablas ya creadas; se repitió
con dueño para preparación, rol sin `BYPASSRLS` para los tests y los mismos
grants que CI. Una aserción de integración se actualizó para el campo nuevo.
