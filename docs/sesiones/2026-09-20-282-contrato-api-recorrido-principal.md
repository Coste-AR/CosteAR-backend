---
issue: 282
repo: CosteAR-backend
pr: 392
rama: feat/282-contrato-recorrido
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-20T04:02-03:00
fin: 2026-09-20T04:21-03:00
minutos: 19
tokens: no-informado
clears: 0
intentos_hasta_verde: 5
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-20 — El recorrido principal ya tiene contrato tipado

## Qué se hizo

- El OpenAPI pasó de una a 19 operaciones del recorrido principal: sesión, cartera, estructura,
  carga de MP/MOD/CIP, cálculo, simulación, períodos, tablero y validaciones.
- Cada operación publica el sobre de éxito y los errores 400/401/403/404/409/422/429/500 desde
  el mismo schema Zod que Fastify usa al responder.
- El artefacto declara versión `1.0.0`; `openapi/openapi.json` y `openapi/types.d.ts` siguen
  regenerándose de forma determinística y el CI detecta deriva.
- El generador excluye las operaciones del mismo archivo que todavía no tienen una respuesta
  declarada. Así el contrato no presenta como tipado algo que no está contrastado.
- El fixture consumidor importa solo `types.d.ts` y ahora usa respuestas reales de login, cálculo
  y tablero.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** cerrar las fases 2–5 del plan anterior en este único PR, pero limitar la
  conversión a las 19 operaciones que componen el recorrido principal pedido.
  **Qué otra opción había:** convertir todas las rutas de los seis archivos registrados o volver
  a dejar el issue parcialmente abierto. **Por qué elegí esta:** Santiago devolvió #282 como el
  primero de B3 para destrabar contratos de pantalla; convertir rutas administrativas y auxiliares
  ampliaba el alcance sin mejorar ese recorrido. Constitución §8.
- **Qué decidí:** filtrar del documento toda operación sin una respuesta JSON declarada.
  **Qué otra opción había:** dejar que Swagger publicara también rutas sin schema como respuestas
  vacías. **Por qué elegí esta:** un contrato incompleto con apariencia de autoridad es peor que
  declarar ausencia. Constitución §2.
- **Qué decidí:** conservar campos adicionales con schemas `passthrough`, pero tipar los campos
  estables que consume la interfaz. **Qué otra opción había:** usar `unknown` para todo el payload
  o serializar solo un subconjunto. **Por qué elegí esta:** `unknown` no detecta deriva y un schema
  cerrado habría eliminado campos existentes al serializar.
- **Qué decidí:** instalar el compilador de serialización en cada plugin convertido.
  **Qué otra opción había:** modificar todos los servidores mínimos de tests. **Por qué elegí
  esta:** el contrato pertenece a la ruta y debe funcionar igual cuando el plugin se registra
  fuera de `buildApp`.

## Dónde el issue no alcanzaba

- No enumeraba qué endpoints exactos forman el “recorrido principal”. Se eligieron las operaciones
  usadas para iniciar sesión, elegir empresa/producto, cargar los tres bloques, calcular/simular,
  trabajar con períodos y revisar cargas.
- No decía cómo evitar que Swagger publicara las rutas vecinas todavía no convertidas. Se adoptó
  inclusión por presencia de respuesta JSON declarada.
- No fijaba un número semántico concreto. Se usó `1.0.0` para la primera superficie principal
  completa; el SHA del commit sigue siendo la revisión inmutable que puede fijar el frontend.

## Qué quedó afuera

- Rutas auxiliares, administrativas, exportación/importación y operaciones que no forman parte del
  recorrido principal. No se publican como tipadas ni se inventan schemas para ellas.
- El consumo dentro de `CosteAR-frontend` corresponde a `Coste-AR/CosteAR-frontend#128`.

## Con qué se verifica

```bash
npm run lint                              # verde
npm run typecheck                         # verde
npm run test -- --maxWorkers=2            # 1814 passed, 4 skipped
npm run test:http -- --maxWorkers=2       # 132 passed
npm run check:openapi                     # verde, artefactos sin deriva
npm run typecheck:openapi-consumer        # verde
npm run test:integration                  # 78 passed, rol costear_app sin BYPASSRLS
npm run test:db                           # 66 passed, dueño + sonda RLS
```

Prueba negativa deliberada: se renombró temporalmente `grossMarginPct` en el schema de cálculo.
`npm run typecheck` falló en el contrato del handler y, después de regenerar,
`npm run typecheck:openapi-consumer` falló en el consumidor. Se restauró el nombre y ambas
verificaciones volvieron a verde.
