# F0 — Reconocimiento — AUD-2026-09-16

## Alcance de esta tanda

Continuación dirigida de `AUD-2026-09-14` (ADVERSA, dos CRÍTICOS: `04a` y `05`) y
`AUD-2026-09-15` (ADVERSA, se mantiene el bloqueo, tres CRÍTICOS nuevos: `15-01`, `15-02`,
`15-03`). Esta sesión responde un pedido de cinco bloques, con la instrucción explícita de correr
la cola entera sin frenar:

1. **P-06 (conjuntos por tamaño)** — nunca ejercitado en ninguna auditoría. Determinar si está
   bloqueado por `04a` y, si no, correrlo entero.
2. **Corrimiento de mix** — ¿el sistema detecta que el punto de equilibrio se mueve cuando cambia
   la composición T1/T2/T3, sin que se mueva un peso de costo?
3. **PE contra el techo del tramo, en pantalla** — nunca se vio con un caso real (M3 del fixture).
4. **Magnitud de AUD-05** — quedó sin medir en `AUD-2026-09-15`.
5. **Insumos quirúrgicos para los issues** — dónde exactamente falla `04a`, el disparador real de
   `normalLossPct`, el conteo del barrido de decimales, y el archivo:línea del conversor.

## Entorno

- Backend: rama `auditoria/AUD-2026-09-14`, working tree con un archivo sin commitear
  (`.claude/skills/costear-auditoria/`) al abrir la sesión — commit local más reciente `09cfa62`.
  Servidor real en `localhost:3000`.
- Frontend: `Costear.web/CosteAR-frontend`, rama `auditoria/AUD-2026-09-14` @ `b0e7b5f` (=
  `origin/staging`). Servidor real en `localhost:5173`.
- Docker: `costear-postgres` (`localhost:5433`) y `costear-redis` (`localhost:6380`), healthy,
  arriba desde antes de esta sesión.
- Fixture: `.claude/skills/costear-auditoria/scripts/calc_fx_av.py`, corrido con `--assert` antes
  de tocar cualquier número: **OK — 36 cuadres verificados**.
- Doctrina de P-06 leída de `references/pruebas-sustantivas.md` — el catálogo de los cuatro
  métodos con sus casos "Ancla" (uniforme/rendimiento técnico/mercado/VNR) **ya vive como
  comentario en el propio código del dominio** (`src/domain/calculations/joint-costs.ts:247-318`),
  no solo en la doctrina — coincide cifra por cifra con lo pedido en el BLOQUE 1.
- Registro real por `/auth/register` en cada script; nada insertado a mano en la base **salvo un
  workaround declarado**: la creación de `UnidadMedida` (necesaria para `Company.unidadGestionId`,
  que a su vez destraba el tablero del dueño) no tiene ningún endpoint HTTP en todo el repo — se
  sembró vía Prisma directo (`evidencia/seed-unidad-gestion.mjs`), como ya hacía
  `prisma/seed-tenant-avicola.ts`. Ver hallazgo `AUD-2026-09-16-08`.

## Scripts de evidencia de esta sesión

Todos en `evidencia/`, corridos con `node` contra el backend real:

| Script | Qué hace |
|---|---|
| `bloque1-joint-costs.mjs` | Los 4 métodos de P-06 contra las anclas del dominio, en un departamento único (sin conversión), + prueba de `marketPrice` negativo (R16) |
| `seed-unidad-gestion.mjs` | Workaround declarado: crea `UnidadMedida` vía Prisma directo (no hay endpoint) |
| `bloque4-aud05-magnitud.mjs` | Estructura ORDERS con MP/MOD/CIF separados en tres categorías exactas ($15M/$2M/$16M) para poder mover EXACTAMENTE $2M de FIJO a VARIABLE |
| `bloque4-parte2-con-unidad.mjs` | Repite la medición con `unidadGestion` seteada (destraba cm/PE/conversor en el tablero) |
| `bloque4-parte3-recalc-correcto.mjs` | Corrige el mecanismo de recálculo (`/cost-structures/:id/calculate` no es el camino — hay que re-guardar una sección) y mide antes/después con recálculo real |
| `bloque3-m3-techo.mjs` | Estructura ORDERS con los números de M3 (PE 1.107,2 fuera del techo 972,3) |
| `bloque5b-normallosspct-disparador.mjs` | 6 casos controlados (tipeado vs. derivado de conteo) para aislar el disparador real de `normalLossPct` |

Capturas en `capturas/`: `bloque3-m3-tablero-sin-techo.jpg`, `bloque3-conversor-divide-por-precio.jpg`.
