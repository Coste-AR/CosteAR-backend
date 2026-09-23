---
issue: 417
repo: CosteAR-backend
pr: 419
rama: feat/417-destinos-catalogo
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-23T10:30:46-03:00
fin: 2026-09-23T10:44:28-03:00
minutos: 14
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-23 — Los accesos rápidos dicen adónde llevan

## Qué se hizo

- El catálogo de preferencias suma `destino` a cada acceso navegable.
- Las rutas se declaran en el paquete del rubro y no en condiciones por clave o
  por cliente. Hoy las dos superficies con pantalla llevan a `/panel-campo`.
- Una superficie sin destino queda afuera sin romper ni vaciar el resto del
  catálogo.
- El contrato OpenAPI y sus tipos se regeneraron con el nuevo campo obligatorio.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** declarar `destinos` junto a cada módulo y conservar
  `superficies` como lista de claves. **Qué otra opción había:** convertir cada
  superficie en un objeto `{ clave, destino }`. **Por qué elegí esta:** evita
  romper el contrato ya consumido por la configuración de módulos y mantiene
  la ruta dentro de `PaqueteRubro` (Constitución §4).
- **Qué decidí:** completar destinos desde el paquete canónico sólo cuando una
  fila persistida anterior no trae el campo entero. **Qué otra opción había:**
  exigir resembrar antes de servir el catálogo. **Por qué elegí esta:** el deploy
  sigue siendo compatible con filas creadas antes de #417, sin inventar rutas
  para mapas parciales nuevos.
- **Qué decidí:** publicar `/panel-campo` para producción y bajas. **Qué otra
  opción había:** crear rutas futuras. **Por qué elegí esta:** es la pantalla
  existente que hoy implementa ambos flujos; las superficies sin pantalla se
  omiten como exige el issue (Constitución §2).

## Dónde el issue no alcanzaba

- No enumeraba las rutas concretas. Se contrastó el router vigente del frontend
  y `FieldPanelPage`: producción diaria y bajas viven en `/panel-campo`.
- No definía cómo representar el destino dentro del JSON del paquete ni cómo
  tratar filas persistidas anteriores. Se eligió una extensión compatible y se
  cubrió explícitamente el mapa parcial para no ocultar configuración faltante.

## Qué quedó afuera

- Las pantallas consumidoras, que corresponden a `CosteAR-frontend#185` y `#189`.
- Crear pantallas o destinos para las otras superficies del paquete; hasta que
  existan, no se publican.

## Con qué se verifica

```bash
npm run lint
# verde
npm run typecheck
# verde
npm test -- --maxWorkers=1
# 222 archivos verdes, 1 skipped; 1.902 tests verdes, 4 skipped existentes
npm run test:http -- --maxWorkers=1
# 31 archivos; 167 tests verdes
npm run test:integration -- --maxWorkers=1
# 28 archivos; 87 tests verdes con rol sin BYPASSRLS
npm run check:openapi
npm run typecheck:openapi-consumer
npm run check:tests-base
# contrato, consumidor tipado y guarda de suites verdes
```

El rojo deliberado mostró que el catálogo todavía no entregaba `destino`. El
primer intento no llegó a ejecutar porque el worktree no tenía dependencias;
después de `npm ci` y `npm run prisma:generate` se obtuvo el rojo funcional. La
preparación local de RLS requirió aplicar políticas con el rol dueño; la suite se
ejecutó luego con `costear_app`, sin `BYPASSRLS`.
