# PASO 5 — En pantalla

Con los cuatro períodos de `FX-AV-B` cargados (PASO 2), navegado con browser real,
`localhost:5173` (frontend) → `localhost:3000` (backend, proxy de `vite.config.ts:14`).

## Nota de entorno — dos backends, una sola base

Había dos procesos backend corriendo (`localhost:3000` y `:3001`), ambos contra la misma Postgres
(`localhost:5433`) — confirmado porque devuelven el mismo `terms.id`. **No son intercambiables
para el login**: una cuenta creada contra `:3001` no autentica contra `:3000` aunque compartan
base (se probó y dio `401 CUIT o contraseña incorrectos` con las credenciales correctas,
verificadas por `curl` directo). El frontend real proxea a `:3000`, así que los datos de PASO 2
para las capturas se cargaron de nuevo, apuntando el script a `:3000` (`evidencia/
paso2-port3000-para-screenshots.log`). Se declara sin resolver la causa raíz (¿DB distinta pese al
mismo `terms.id`? ¿usuario con RLS/tenant distinto?) — no era el objeto de esta auditoría y no se
investigó más.

## Capturas

### `01-comparacion-M3-vs-M4.jpg` — pantalla "Comparación"
M3 (Marzo, cerrado) vs. M4 (Abril, cerrado). Costo total $22.651.255,17 (antes $24.064.788,24,
−5,9%), tabla "de dónde vino el cambio" por Materia prima / Mano de obra / CIF. **Confirma en
pantalla, no solo por API, el hallazgo de PASO 4.3/4.4: no hay ninguna mención de punto de
equilibrio, techo de tramo, ni mix** — la pantalla que existe para explicar variaciones entre
períodos no cubre ninguna de las dos preguntas centrales del fixture para M2→M3.

### `02-resultado-M4-planta.jpg` — pantalla "Resultado", Abril 2026
Costo del producto terminado (Embolsado, Abril 2026): $14.632,594/bolsa. Materia Prima
$211,215 · Costo de Conversión $36,000 · Costo unitario acumulado $247,215 — coincide con los
números verificados por API en `02-paso2-fxavb.md` (Planta M4: u.MP $211,22, u.CC $36,00).

### `03-resultado-M2-mp-220-exacto.jpg` — pantalla "Resultado", Febrero 2026
**El chequeo específico pedido.** Materia Prima **$220,000** (formato AR = $220,00 exacto) — no
$217,20. Confirma en pantalla, no solo por `GET`, que el sistema **no revalúa la existencia
inicial** al costo del período nuevo.

## Lo que NO se pudo capturar

- **El conversor de pesos a cajones en dos períodos distintos** — pedido explícito del PASO 5, no
  reproducible con la empresa `FX-AV-B` de esta sesión: es una estructura de Procesos sin precio
  de venta ni unidad de gestión configurados (no hacía falta para lo que pedían los PASOS 1-4).
  El conversor vive en el tablero del dueño, que ya está confirmado roto por otro motivo
  (`AUD-2026-09-14`, error vivo n.º 1: divide por precio en vez de por `cm`) — репроducirlo de
  nuevo con esta empresa no hubiera agregado evidencia nueva sobre ESE hallazgo, y no había
  presupuesto en esta sesión para cargar ventas y unidad de gestión además de las cuatro
  estructuras que sí se auditaron. **Declarado, no simulado.**
- **PE de M3 contra su techo** — mismo motivo: esta empresa no tiene la capa marginal (`cm`/PE)
  configurada; el fixture M3 (con el galpón nuevo) tampoco se cargó esta sesión (es de la cadena
  Granja→Fraccionadora, no de `FX-AV-B`).
