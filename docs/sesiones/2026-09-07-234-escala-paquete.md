# 2026-09-07 — Escala física declarada y cascada de paquete

- **Issue:** #234
- **Repo:** CosteAR-backend
- **Rama:** `feat/issue-234-escala-paquete`
- **PR:** pendiente
- **Agente:** Codex

## Recursos

| Recurso | Registro |
| --- | --- |
| Tiempo de la sesión | no informado |
| Tokens consumidos | no informado |
| Intentos hasta el verde | 2 para el contrato unitario: rojo sin implementación y verde tras declararlo |
| Migración | `npm.cmd run prisma:migrate operation-scale-package` en una base temporal local limpia |
| Verificaciones | `npm.cmd exec vitest run tests/schemas/company-schema.test.ts tests/application/paquete-rubro-service.test.ts`, `npm.cmd run test:http`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run check:tests-base`, `npm.cmd run test -- --reporter=dot --silent`, `npm.cmd run test:integration` |

## Qué se hizo

Se declaró `operationScale` como contrato atómico `{ value, unit }`: cantidad física producida
durante un año. Se persiste en `Company.operationScaleValue` y `Company.operationScaleUnit`, ambos
nullable para conservar el comportamiento de una empresa sin declaración.

`PaqueteRubro` suma el slot nullable `scale`. `PaqueteRubroService.resolve()` conserva la cascada
existente y una fila más específica reemplaza la escala de una menos específica sólo cuando declara
el slot. La ausencia no se convierte en un valor plausible.

La migración aditiva `20260907204851_operation_scale_package` agrega exclusivamente las dos
columnas de empresa y el JSONB del paquete.

## Verificación de falla y éxito

La primera corrida de las nuevas pruebas falló en los dos casos porque los campos no existían:
`expected undefined to deeply equal { value, unit }`. Después de implementar el contrato:

- Pruebas focalizadas: 2 archivos, 12 pruebas en verde.
- `npm.cmd run test:http`: 13 archivos, 82 pruebas en verde.
- `npm.cmd run lint` y `npm.cmd run typecheck`: sin errores.
- `npm.cmd run check:tests-base`: todos los tests con base están declarados.
- Suite unitaria: 170 archivos en verde, 1 omitido; 1550 pruebas en verde, 4 omitidas.
- Integración contra Postgres con `costear_app` (`NOSUPERUSER NOBYPASSRLS`): 18 archivos y 56
  pruebas en verde. Incluye la persistencia, el caso sin escala y la precedencia de dos paquetes.

## Decisiones tomadas

- **Decisión:** medir la escala como cantidad física anual, con unidad explícita por declaración.
- **Alternativa:** usar facturación, precio o una escala implícita desde el perfil de rubro.
- **Motivo:** los importes cambian y no son comparables; la cantidad física anual sí permite que un
  perfil declare luego su propia unidad de calibración. No se infiere ni se convierte una unidad
  en silencio.

- **Decisión:** dejar `scale` del paquete en `null` hasta que un rubro lo declare.
- **Alternativa:** sembrar umbrales o una escala por defecto.
- **Motivo:** el issue no aporta escalas calibradas y el consumidor es #202. Inventar datos haría
  parecer disponible un dato que no existe.

## Dónde el issue no alcanzaba

El issue pide elegir una unidad pero no fija una taxonomía transversal de unidades ni factores de
conversión entre empresas. Se declaró el contrato físico anual y el campo `unit`; la comparación
o conversión queda expresamente para el consumidor posterior, no se deduce en este PR.

La base local compartida tenía una migración de unidad de gestión equivalente bajo otro timestamp,
por lo que Prisma pedía resetearla. No se borró nada: se generó y probó la migración en una base
temporal limpia y se restauró el registro de la migración fallida que produjo el intento inicial.

## Fuera de alcance

No se tocó `src/infrastructure/classifier/`, sus pesos, vocabulario ni resultados. Tampoco se
agregaron escalas de calibración, umbrales, conversiones o consumidores: pertenecen a #202.
