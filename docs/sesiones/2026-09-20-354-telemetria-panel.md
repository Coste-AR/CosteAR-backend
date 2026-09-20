---
issue: 354
repo: CosteAR-backend
pr: 393
rama: feat/354-telemetria-panel
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-20T08:01-03:00
fin: 2026-09-20T08:17-03:00
minutos: 16
tokens: no-informado
clears: 0
intentos_hasta_verde: 4
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-20 — El panel guarda telemetría sin identificar personas

## Qué se hizo

- Se agregó `POST /api/v1/companies/:companyId/telemetria-panel` con cuatro tipos cerrados:
  acción tocada, carga iniciada, abandonada y completada.
- El evento conserva la empresa, una clave técnica de acción, duración en milisegundos, rol técnico
  y hora del servidor. No guarda actor, nombre, email, IP, user-agent, importes ni cantidades.
- La migración es aditiva y la tabla está aislada por RLS. Una prueba con Postgres real confirma
  que el tenant dueño ve el evento y otro tenant no.
- El contrato está publicado en OpenAPI y los tipos generados. El frontend puede consumirlo desde
  `Coste-AR/CosteAR-frontend#98`.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** rechazar todo campo no declarado en vez de descartarlo silenciosamente.
  **Qué otra opción había:** limpiar el payload y guardar la parte conocida. **Por qué elegí esta:**
  el rechazo hace visible una instrumentación insegura y evita creer que se está midiendo algo que
  en realidad se perdió. Constitución §2.
- **Qué decidí:** usar una clave técnica restringida para la acción y no aceptar texto libre.
  **Qué otra opción había:** permitir una descripción arbitraria. **Por qué elegí esta:** el texto
  libre puede transportar nombres o valores del formulario y romper el anonimato.
- **Qué decidí:** exigir `duracionMs` sólo en carga abandonada o completada; acción tocada e inicio
  no la aceptan. **Qué otra opción había:** hacerla opcional para todos los eventos. **Por qué elegí
  esta:** la unidad viaja en el nombre del campo y la ausencia queda declarada por el tipo de evento,
  sin inventar cero. Constitución §2 y §3.
- **Qué decidí:** persistir `userId` como dueño del tenant para RLS, pero nunca el id del actor.
  **Qué otra opción había:** guardar al usuario que tocó la pantalla. **Por qué elegí esta:** permite
  aislamiento entre empresas sin convertir telemetría de uso en seguimiento personal.

## Dónde el issue no alcanzaba

- No fijaba la ruta ni los nombres de los campos; se usó vocabulario español consistente con el
  resto del API y una ruta bajo empresa porque el panel siempre opera dentro de una empresa.
- No decía qué eventos llevan duración. Se definió sólo para los dos eventos terminales de una
  carga, que son los que tienen un intervalo completo medible.
- “Rol técnico si está disponible” no distinguía puesto libre de rol de autenticación. Se conserva
  el rol cerrado (`COSTISTA` o `EMPRESA_OPERATOR`) para evitar que un puesto libre identifique a una
  persona.
- La base local compartida tenía deriva de una corrida anterior. Para no borrar datos se creó una
  base local desechable `costear_354` y allí se generó/probó la migración.

## Qué quedó afuera

- Consulta, retención y panel de análisis, excluidos expresamente por #354.
- Instrumentación y tolerancia a fallas del frontend, que corresponden a
  `Coste-AR/CosteAR-frontend#98`. El backend no acopla este endpoint a ninguna mutación operativa.

## Con qué se verifica

```bash
npx vitest run tests/http/telemetria-panel.test.ts  # rojo 6/6 antes; verde 6/6 después
npm run lint                                        # verde
npm run typecheck                                   # verde
npm run test -- --maxWorkers=2                      # 1820 passed, 4 skipped
npm run test:http -- --maxWorkers=2                 # 138 passed
npm run test:integration                            # 79 passed, rol sin BYPASSRLS
npm run test:db                                     # 66 passed, dueño + sonda RLS
npm run check:tests-base                            # verde
npm run check:openapi                               # verde
npm run typecheck:openapi-consumer                  # verde
npx prisma validate                                 # verde
```

La prueba negativa deliberada creó primero los seis casos HTTP sin la ruta: fallaron 6/6. Después
de implementar, cuatro payloads con `importe`, `cantidad`, `nombre` o `personaId` son rechazados y
no se persisten; una carga abandonada sin duración también se rechaza.
