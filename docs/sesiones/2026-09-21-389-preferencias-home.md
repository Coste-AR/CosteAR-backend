---
issue: 389
repo: CosteAR-backend
pr: 406
rama: feat/389-preferencias-home
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-21T15:03:40-03:00
fin: 2026-09-21T17:16:00-03:00
minutos: 133
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-21 — Los accesos rápidos sobreviven al dispositivo

## Qué se hizo

- Se agregaron `GET /me/preferencias`, `PUT /me/preferencias` y
  `GET /me/preferencias/catalogo` al contrato OpenAPI.
- La preferencia se guarda una vez por usuario como JSON validado, conserva el
  orden de hasta seis accesos y se audita en la misma transacción.
- El catálogo deriva sus claves de las superficies de los módulos del paquete y
  publica sólo las de módulos prendidos. Sin fila guardada, el GET devuelve el
  default del catálogo.
- `user_preferences` es una migración aditiva con RLS forzada por usuario.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** usar las superficies declaradas por los módulos como claves de
  widget. **Qué otra opción había:** mantener un segundo catálogo estático.
  **Por qué elegí esta:** evita dos fuentes de verdad y aplica Constitución §4.
- **Qué decidí:** distinguir una clave inexistente de una superficie válida cuyo
  módulo está apagado. **Qué otra opción había:** responder el mismo 422 genérico.
  **Por qué elegí esta:** el error requerido queda accionable y nombra la clave.
- **Qué decidí:** resolver la primera empresa activa de forma determinista hasta
  #401. **Qué otra opción había:** agregar `companyId` a un contrato `/me` que no
  lo pide. **Por qué elegí esta:** conserva el contrato solicitado y documenta
  explícitamente la compatibilidad (Constitución §9; ADR 0029).
- **Qué decidí:** no borrar ni reescribir preferencias cuando se apaga un módulo.
  **Qué otra opción había:** mutarlas desde la configuración de módulos.
  **Por qué elegí esta:** nada se pisa; catálogo y próximo PUT reflejan el estado.

## Dónde el issue no alcanzaba

- No definía las claves ni etiquetas concretas de widgets. Se reutilizaron las
  superficies y nombres que el paquete ya publica.
- No definía cómo elegir empresa para una cuenta legacy con varias. Se tomó la
  primera activa por fecha hasta que #401 provea el contexto empresarial nuevo.
- El límite de seis estaba en el issue consumidor `CosteAR-frontend#189`, no en
  #389; se fijó también en Zod para que el backend sostenga el contrato.

## Qué quedó afuera

- Preferencias distintas de `home.accesosRapidos` y preferencias compartidas.
- La pantalla y el ordenamiento visual, que corresponden a frontend #189.
- La resolución definitiva del contexto empresarial, que corresponde a #401.

## Con qué se verifica

```bash
npm run lint
npm run typecheck
npm test -- --maxWorkers=1
# 216 archivos verdes, 1 skipped; 1.872 tests verdes, 4 skipped existentes
npm run test:http -- --maxWorkers=1
# 27 archivos; 150 tests verdes
npm run test:integration -- --maxWorkers=1
# 27 archivos; 83 tests verdes con rol sin BYPASSRLS
npm run test:db -- --maxWorkers=1
# 5 archivos; 66 tests verdes con sonda RLS y claves RSA efímeras
npm run check:tests-base
npm run check:openapi
npm run typecheck:openapi-consumer
npx prisma validate
# guardas, consumidor tipado y schema verdes; 31 operaciones OpenAPI
```

Rojo deliberado: los cinco casos nuevos fallaron antes de implementar porque la
ruta no existía. El primer arranque se frenó antes por dependencias ausentes en
el worktree; después de `npm ci` se obtuvo el rojo funcional. El primer
`db:setup` no tenía `DATABASE_URL`; la primera integración intentó aplicar RLS
con el rol restringido y luego encontró que la base desechable todavía no tenía
los grants de `costear_app`; la primera suite DB usó el placeholder RS256. Cada
una se repitió con el rol dueño, los grants del init o las claves efímeras que
exige la suite.

## Reconciliación posterior con `dev`

El 21-09 a las 22:05 (-03:00), el PR quedó en conflicto después de entrar #390.
Se conservaron ambas altas en RLS, el registro de modelos y el generador; los
artefactos OpenAPI se regeneraron desde las 32 operaciones tipadas. La
reconciliación tomó 13 minutos, sin clears ni rebotes de guarda.

Verificación del estado integrado: lint, typecheck, OpenAPI y consumidor
tipado verdes; 1.878 unitarios, 152 HTTP, 85 integración/RLS y 66 DB (32
ejecutados, 34 skips previstos) verdes. La primera preparación de integración
no tenía `DATABASE_URL`; la primera DB usó el rol restringido y la segunda el
placeholder RS256. Se repitieron con base local desechable, rol dueño para DB y
claves RSA efímeras.
