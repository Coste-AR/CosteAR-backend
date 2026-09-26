---
issue: 476
repo: CosteAR-backend
pr: pendiente
rama: feat/costos-directos-contingencias
agente: codex
modelo: gpt-5
tanda: C1
inicio: 2026-09-25T22:57-03:00
fin: 2026-09-25T23:15-03:00
minutos: 18
tokens: no-informado
clears: 0
intentos_hasta_verde: 6
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-25 — Costos directos y contingencias quedan separados por orden

## Qué se hizo

- Se agregaron costos directos y eventos de contingencia por orden y etapa, con auditoría atómica, RLS y migración aditiva.
- Los costos nacen pendientes y sólo los validados integran los totales; entrega e instalación se informan separadas de fabricación.
- La política de retrabajo se configura por empresa (`CIF_POOL`, `PERDIDA_PERIODO` o `CAMBIO_CLIENTE`) y no convierte el retrabajo en consumo de la orden.
- Un cambio del cliente sin adicional aprobado queda marcado, y una falla de proveedor exige recupero o reclamo.
- Se publicaron los cuatro contratos HTTP pedidos y se regeneró OpenAPI.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** representar la validación con `PENDIENTE`, `VALIDADO` y `MARCADO`. **Alternativa:** reutilizar el estado de una entrada documental sin relación con la orden. **Por qué:** preserva ausencia declarada y evita que una carga impacte antes de validarse (Constitución §2 y §6).
- **Qué decidí:** congelar en cada retrabajo la política vigente de la empresa. **Alternativa:** consultar la política actual al leer. **Por qué:** una modificación futura no debe reclasificar hechos históricos.
- **Qué decidí:** exponer resúmenes de importes validados en los GET. **Alternativa:** devolver sólo filas y obligar al consumidor a repetir reglas. **Por qué:** la API declara qué impacta y evita cálculos implícitos del usuario (Constitución §1).

## Dónde el issue no alcanzaba

- No definía el enum de `estadoValidacion`; se eligieron tres estados explícitos para distinguir espera, aprobación y observación.
- No pedía una ruta de aprobación propia. Las altas quedan pendientes para el panel de validación y este PR no inventa permisos ni UX fuera de alcance (Constitución §8 y §9).
- La base compartida tenía una migración ajena fallida. Se usó `costear_476`, base aislada, sin alterar ese estado.
- La base aislada no hereda los grants del bootstrap del contenedor; se otorgaron permisos de prueba al rol `costear_app` antes de ejecutar la suite RLS.

## Qué quedó afuera

- Pools e indirectos, incluidos el agregado real de `CIF_POOL`, pertenecen a #477.
- La pantalla y acción del panel que cambia `PENDIENTE` a `VALIDADO` no estaban definidas por este issue.

## Con qué se verifica

```bash
npm run lint                         # verde
npm run typecheck                    # verde
npm run test                         # 2.043 verdes, 4 omitidos
npm run test:http                    # 209 verdes
npm run test:integration             # 96 verdes, rol sin BYPASSRLS
npm run check:openapi                # verde, 77 operaciones
npm run typecheck:openapi-consumer   # verde
npm run check:tests-base             # verde
npm run prisma:generate              # verde
npm run prisma:deploy                # 110 migraciones en base limpia, verde
npm run db:rls                       # 331 sentencias, verde
```
