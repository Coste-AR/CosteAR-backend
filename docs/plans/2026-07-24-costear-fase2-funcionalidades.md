# Fase 2 — Funcionalidades y arquitectura restantes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los tres hallazgos de la auditoría que son 100% código (no dependen de una cuenta externa, presupuesto de infraestructura, ni decisión de producto ajena): reconectar el panel de comparación de períodos con un contraste macro real, construir el canal de ingesta por WhatsApp (Meta Cloud API, ya elegida), y agregar caché a las llamadas al RAG para controlar costo.

**Architecture:** Mismo patrón que la Fase 1 — aditivo, sin tocar el motor de cálculo ni los contratos existentes, con inyección de dependencias por constructor para que todo sea testeable. La comparación de períodos sigue siendo un módulo puro (`period-comparison.ts`) sin DB; el contraste macro se calcula aparte, en la capa de aplicación que ya toca DB (`cost-period-service.ts`), y se le pega al resultado.

**Tech Stack:** Node 22, TypeScript, Fastify, Prisma, Vitest, Decimal.js (toda la aritmética de plata), Meta WhatsApp Cloud API (webhooks).

**Alcance de este documento:** Solo código, ejecutable y mergeable a `dev` sin depender de nadie más. Fuera de este plan (necesitan cuenta/infra/decisión de producto, no son código): el rol de DB dedicado en Railway (RLS), un segundo entorno de staging, documentar el deploy de `CosteAR-admin`, decidir qué hacer con el endpoint huérfano `GET /macro/landing`, y decidir si se reactiva o se borra el código muerto de `CREATE_ENTRY`/`CREATE_ALERT` en el chat del costista (ver charla anterior — no lo até por mi cuenta porque es una decisión de producto, no un bug).

---

## Task 1: Contraste macro en la comparación de períodos

**Contexto:** El panel "Variación de Costos País" del dashboard mostraba un `+20.4%` inventado a mano y ya se sacó. El motor real para esto (`period-comparison.ts`) ya existe, está testeado, y abre la variación de cada materia prima en PRECIO vs CONSUMO — el efecto PRECIO es, literalmente, "cuánto entró el país" (inflación vía insumos). Esta tarea agrega el contraste: cuánto subió la inflación nacional (IPC, ya ingestada en `MacroSnapshot`) en la misma ventana de tiempo que se está comparando, para que el costista pueda leer "mis costos subieron X%, el país subió Y%".

**Decisión de arquitectura (por qué esta versión y no la del dashboard viejo):** el panel viejo era un agregado a nivel de TODA la cartera del costista (todas sus empresas juntas) — esa agregación no existe hoy y construirla desde cero es un cambio grande y sin testear. En cambio, `GET /structures/:id/periods/compare` ya compara dos períodos de UNA estructura, está testeado, y ya se usa en `PeriodComparison.tsx`. Esta tarea extiende ESE endpoint con el contraste macro — mismo alcance (una estructura, dos períodos), cero invención de agregación nueva. Si más adelante se quiere una vista de cartera completa, es una iteración aparte sobre esta base.

**Regla de oro (ya decidida por el equipo, `DECISIONES.md` 13/07):** el contraste solo se muestra si los DOS períodos están `CLOSED` (números congelados, no en movimiento). Si no, `macroContrast: null` con la razón — nunca se inventa ni se aproxima con períodos abiertos.

**IPC_NACIONAL se ingesta como tasa MENSUAL** (confirmado en `costista-chat-service.ts`: `"IPC mensual: X%"`), no como índice acumulado. Para comparar dos meses no contiguos hay que COMPONER las tasas mensuales de todo el rango, no restar dos puntos.

**Files:**
- Modify: `src/application/macro/macro-service.ts`
- Modify: `src/application/cost-structures/cost-period-service.ts`
- Modify: `src/application/cost-structures/period-comparison.ts` (solo el tipo `PeriodComparison`, no la lógica pura)
- Modify: `CosteAR-frontend/src/features/cost-structures/comparison-hooks.ts`
- Modify: `CosteAR-frontend/src/features/cost-structures/components/PeriodComparison.tsx`
- Test: `tests/application/macro-cumulative-inflation.test.ts` (nuevo)
- Test: `tests/application/cost-period-compare.test.ts` (extender el existente)

### Step 1: Escribir el test que falla (composición de inflación acumulada)

Crear `tests/application/macro-cumulative-inflation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = { macroSnapshot: { findMany: vi.fn() } };
vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));

beforeEach(() => vi.clearAllMocks());

describe('MacroService.cumulativeInflation', () => {
  it('compone tasas mensuales (no las suma): dos meses de 5% dan 10.25%, no 10%', async () => {
    const { MacroService } = await import('@/application/macro/macro-service.js');
    mockDb.macroSnapshot.findMany.mockResolvedValue([
      { indicatorCode: 'IPC_NACIONAL', value: '5', effectiveDate: new Date('2026-05-31') },
      { indicatorCode: 'IPC_NACIONAL', value: '5', effectiveDate: new Date('2026-06-30') },
    ]);

    const svc = new MacroService(mockDb as never);
    const res = await svc.cumulativeInflation(new Date('2026-05-01'), new Date('2026-06-30'));

    expect(res).not.toBeNull();
    expect(res!.deltaPct).toBe(10.25); // (1.05 * 1.05 - 1) * 100
    expect(res!.monthsUsed).toBe(2);
    expect(res!.snapshots).toHaveLength(2);
  });

  it('sin ningún snapshot de IPC en el rango, devuelve null (nunca inventa)', async () => {
    const { MacroService } = await import('@/application/macro/macro-service.js');
    mockDb.macroSnapshot.findMany.mockResolvedValue([]);

    const svc = new MacroService(mockDb as never);
    const res = await svc.cumulativeInflation(new Date('2026-05-01'), new Date('2026-06-30'));

    expect(res).toBeNull();
  });

  it('un solo mes en el rango compone igual (factor único)', async () => {
    const { MacroService } = await import('@/application/macro/macro-service.js');
    mockDb.macroSnapshot.findMany.mockResolvedValue([
      { indicatorCode: 'IPC_NACIONAL', value: '4.2', effectiveDate: new Date('2026-06-30') },
    ]);

    const svc = new MacroService(mockDb as never);
    const res = await svc.cumulativeInflation(new Date('2026-06-01'), new Date('2026-06-30'));

    expect(res!.deltaPct).toBe(4.2);
    expect(res!.monthsUsed).toBe(1);
  });
});
```

### Step 2: Correr el test y verificar que falla

Run: `npm test -- tests/application/macro-cumulative-inflation.test.ts`
Expected: FAIL — `MacroService` hoy no acepta `db` inyectable por constructor (usa el `prisma` importado directo) ni tiene el método `cumulativeInflation`.

### Step 3: Implementar `MacroService.cumulativeInflation` (+ hacerlo inyectable)

En `src/application/macro/macro-service.ts`, el constructor YA acepta `db` inyectable (`constructor(private readonly db: PrismaClient = prisma) {}` — confirmalo al leer el archivo; si por algún motivo no lo tuviera, agregalo con ese mismo patrón antes de seguir).

Agregar el import de `Decimal` al tope del archivo:

```ts
import { Decimal } from 'decimal.js';
```

Y el método nuevo, después de `history()`:

```ts
  /**
   * Inflación NACIONAL acumulada entre dos fechas, componiendo las tasas
   * mensuales de IPC_NACIONAL (no las suma: dos meses al 5% dan 10.25%, no 10%).
   *
   * Devuelve null si no hay NINGÚN snapshot de IPC en el rango — nunca se
   * inventa un número ni se aproxima con datos parciales silenciosos.
   */
  async cumulativeInflation(
    from: Date,
    to: Date,
  ): Promise<{ deltaPct: number; monthsUsed: number; snapshots: { value: number; effectiveDate: Date }[] } | null> {
    const rows = await this.db.macroSnapshot.findMany({
      where: { indicatorCode: 'IPC_NACIONAL', effectiveDate: { gte: from, lte: to } },
      orderBy: { effectiveDate: 'asc' },
    });

    if (rows.length === 0) return null;

    let factor = new Decimal(1);
    for (const row of rows) {
      factor = factor.times(new Decimal(1).plus(new Decimal(row.value.toString()).dividedBy(100)));
    }

    return {
      deltaPct: factor.minus(1).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toNumber(),
      monthsUsed: rows.length,
      snapshots: rows.map((r) => ({ value: Number(r.value), effectiveDate: r.effectiveDate })),
    };
  }
```

### Step 4: Correr el test y verificar que pasa

Run: `npm test -- tests/application/macro-cumulative-inflation.test.ts`
Expected: PASS (3/3)

### Step 5: Conectar el contraste macro a `compare()`

Primero, extender el tipo `PeriodComparison` en `src/application/cost-structures/period-comparison.ts` (agregar el campo, NO tocar la función pura `comparePeriods` ni ninguna otra lógica del archivo):

```ts
export interface MacroContrast {
  indicatorCode: string;
  indicatorLabel: string;
  deltaPct: number;
  monthsUsed: number;
  /** Los snapshots mensuales que se compusieron, para que el número se pueda auditar a ojo. */
  snapshots: { value: number; effectiveDate: string }[];
}
```

Y agregar `macroContrast: MacroContrast | null;` al final de la interfaz `PeriodComparison` (después de `warnings: string[];`).

Ahora en `src/application/cost-structures/cost-period-service.ts`: agregar el import de `MacroService` y `type MacroContrast`:

```ts
import { MacroService } from '../macro/macro-service.js';
import type { MacroContrast } from './period-comparison.js';
```

Agregar `MacroService` al constructor de la clase (mismo patrón DI que ya usa el resto del archivo — buscá el constructor existente y agregale el parámetro con default):

```ts
private readonly macro: MacroService = new MacroService(),
```

Y en el método `compare()`, reemplazar el `return comparePeriods(this.toSide(older), this.toSide(newer));` final por:

```ts
    const comparison = comparePeriods(this.toSide(older), this.toSide(newer));

    let macroContrast: MacroContrast | null = null;
    if (older.status === 'CLOSED' && newer.status === 'CLOSED') {
      const inflation = await this.macro.cumulativeInflation(older.endDate, newer.endDate);
      if (inflation) {
        macroContrast = {
          indicatorCode: 'IPC_NACIONAL',
          indicatorLabel: 'Inflación nacional (IPC)',
          deltaPct: inflation.deltaPct,
          monthsUsed: inflation.monthsUsed,
          snapshots: inflation.snapshots.map((s) => ({
            value: s.value,
            effectiveDate: s.effectiveDate.toISOString().slice(0, 10),
          })),
        };
      }
    }

    return { ...comparison, macroContrast };
```

### Step 6: Extender el test existente de comparación

`tests/application/cost-period-compare.test.ts` ya existe con este contenido real (confirmado leyendo el archivo): usa `CostPeriodService(db as never)` con un solo argumento, un helper `period(o)` que arma objetos de período SIN `startDate`/`endDate`, y dos fixtures a nivel de módulo (`mayo`, `junio`) reusados en varios `it`. Los cambios de abajo son diffs precisos contra ESE archivo.

**Primero**, extender el helper `period()` para que soporte fechas (retrocompatible — si no se pasan, se derivan del `code`, así que los 6 tests existentes siguen funcionando sin tocarlos). Cambiar:

```ts
function period(o: {
  code: string;
  label: string;
  status?: 'OPEN' | 'CLOSED';
  snap?: ReturnType<typeof snapshot> | null;
  units?: number;
}) {
  return {
    id: `per-${o.code}`,
    structureId: STRUCTURE,
    userId: USER,
    code: o.code,
    label: o.label,
    status: o.status ?? 'CLOSED',
    resultSnapshot: o.snap ?? null,
    rawMaterialConfig: { materials: [] },
    directLaborConfig: {},
    indirectCostConfig: { centers: [] },
    salesUnitPrice: 5000,
    salesQuantity: o.units ?? 100,
  };
}
```

a:

```ts
function period(o: {
  code: string;
  label: string;
  status?: 'OPEN' | 'CLOSED';
  snap?: ReturnType<typeof snapshot> | null;
  units?: number;
  startDate?: Date;
  endDate?: Date;
}) {
  return {
    id: `per-${o.code}`,
    structureId: STRUCTURE,
    userId: USER,
    code: o.code,
    label: o.label,
    status: o.status ?? 'CLOSED',
    resultSnapshot: o.snap ?? null,
    rawMaterialConfig: { materials: [] },
    directLaborConfig: {},
    indirectCostConfig: { centers: [] },
    salesUnitPrice: 5000,
    salesQuantity: o.units ?? 100,
    startDate: o.startDate ?? new Date(`${o.code}-01`),
    endDate: o.endDate ?? new Date(`${o.code}-28`),
  };
}
```

**Después**, agregar un `describe` nuevo al final del archivo (después del `describe('COMPARAR períodos (servicio)', ...)` existente, mismo nivel):

```ts
describe('COMPARAR períodos — contraste macro', () => {
  it('macroContrast va null si alguno de los dos períodos no está CLOSED (regla de oro: nunca datos parciales)', async () => {
    const db = makeDb([
      period({ code: '2026-06', label: 'Junio 2026', snap: null, status: 'OPEN' }),
      mayo,
    ]);
    const mockMacro = { cumulativeInflation: vi.fn() };
    const svc = new CostPeriodService(db as never, mockMacro as never);

    const c = await svc.compare(USER, STRUCTURE);

    expect(c.macroContrast).toBeNull();
    expect(mockMacro.cumulativeInflation).not.toHaveBeenCalled();
  });

  it('macroContrast trae la inflación compuesta cuando los dos períodos están CLOSED', async () => {
    const db = makeDb([junio, mayo]);
    const mockMacro = {
      cumulativeInflation: vi.fn().mockResolvedValue({
        deltaPct: 10.25,
        monthsUsed: 2,
        snapshots: [
          { value: 5, effectiveDate: new Date('2026-05-28') },
          { value: 5, effectiveDate: new Date('2026-06-28') },
        ],
      }),
    };
    const svc = new CostPeriodService(db as never, mockMacro as never);

    const c = await svc.compare(USER, STRUCTURE);

    expect(mockMacro.cumulativeInflation).toHaveBeenCalledWith(mayo.endDate, junio.endDate);
    expect(c.macroContrast).toEqual({
      indicatorCode: 'IPC_NACIONAL',
      indicatorLabel: 'Inflación nacional (IPC)',
      deltaPct: 10.25,
      monthsUsed: 2,
      snapshots: [
        { value: 5, effectiveDate: '2026-05-28' },
        { value: 5, effectiveDate: '2026-06-28' },
      ],
    });
  });

  it('sin datos de IPC en el rango, macroContrast es null aunque los dos períodos estén CLOSED', async () => {
    const db = makeDb([junio, mayo]);
    const mockMacro = { cumulativeInflation: vi.fn().mockResolvedValue(null) };
    const svc = new CostPeriodService(db as never, mockMacro as never);

    const c = await svc.compare(USER, STRUCTURE);

    expect(c.macroContrast).toBeNull();
  });
});
```

Esto exige que `CostPeriodService` acepte `macro` como segundo parámetro del constructor (`new CostPeriodService(db as never, mockMacro as never)`) — coincide con el cambio del Step 5.

### Step 7: Correr toda la suite + typecheck

Run: `npm test && npm run typecheck`
Expected: todo en verde.

### Step 8: Commit backend

```bash
git add src/application/macro/macro-service.ts src/application/cost-structures/cost-period-service.ts src/application/cost-structures/period-comparison.ts tests/application/macro-cumulative-inflation.test.ts tests/application/cost-period-compare.test.ts
git commit -m "feat(periods): contraste con inflacion nacional real en la comparacion de periodos"
```

### Step 9: Frontend — mostrar el contraste

En `CosteAR-frontend/src/features/cost-structures/comparison-hooks.ts`, agregar el tipo (mismo estilo que el resto del archivo, que ya mirror-ea el backend campo por campo):

```ts
export interface MacroContrast {
  indicatorCode: string;
  indicatorLabel: string;
  deltaPct: number;
  monthsUsed: number;
  snapshots: { value: number; effectiveDate: string }[];
}
```

Y agregar `macroContrast: MacroContrast | null;` a la interfaz `PeriodComparison` existente en ese archivo (al final, mismo orden que el backend).

En `CosteAR-frontend/src/features/cost-structures/components/PeriodComparison.tsx`: leé el archivo completo primero para entender dónde termina el bloque de "Componentes del costo" (MP/MOD/CIF) y agregar, INMEDIATAMENTE DESPUÉS de ese bloque (antes de la sección de materiales), una tarjeta nueva:

```tsx
{comparison.macroContrast ? (
  <Card className="border border-line">
    <CardHeader>
      <h3 className="text-sm font-semibold text-ink">¿Mis costos subieron más que el país?</h3>
    </CardHeader>
    <CardBody className="space-y-2">
      <p className="text-sm text-ink-soft">
        {comparison.macroContrast.indicatorLabel} en el mismo período (
        {comparison.macroContrast.monthsUsed} {comparison.macroContrast.monthsUsed === 1 ? 'mes' : 'meses'}):{' '}
        <span className="font-semibold tabular">
          {comparison.macroContrast.deltaPct > 0 ? '+' : ''}
          {formatPercent(comparison.macroContrast.deltaPct)}
        </span>
      </p>
      <p className="text-xs text-ink-soft">
        Tu costo de materia prima (efecto precio) en el mismo período:{' '}
        <span className="font-semibold tabular">
          {comparison.materials.reduce((acc, m) => acc + m.priceEffect, 0) > 0 ? '+' : ''}
          {formatMoney(comparison.materials.reduce((acc, m) => acc + m.priceEffect, 0))}
        </span>
      </p>
    </CardBody>
  </Card>
) : (
  <p className="text-xs text-ink-soft italic">
    No hay contraste con inflación nacional disponible: hace falta que los dos períodos comparados estén
    cerrados y que haya datos de IPC cargados para ese rango.
  </p>
)}
```

(Ajustá los nombres exactos de `Card`/`CardHeader`/`CardBody`/`formatPercent`/`formatMoney` a como ya se usan en el resto del archivo — ya están importados arriba, no agregues imports nuevos salvo que falte alguno.)

### Step 10: Verificación manual en navegador

Con el backend local levantado (Docker + Postgres + `MACRO_SYNC_CRON` habiendo corrido al menos una vez, o snapshots de `IPC_NACIONAL` cargados a mano vía `/macro/manual-entry`): abrir una estructura de costos con al menos 2 períodos CERRADOS, ir a la pestaña Comparación, y confirmar que aparece la tarjeta nueva con el % de inflación real (no inventado) o el mensaje de "no disponible" si falta algo.

### Step 11: Commit frontend

```bash
cd CosteAR-frontend
git add src/features/cost-structures/comparison-hooks.ts src/features/cost-structures/components/PeriodComparison.tsx
git commit -m "feat(periods): mostrar contraste con inflacion nacional en la comparacion"
```

---

## Task 2: Canal de ingesta por WhatsApp (Meta Cloud API)

**Contexto:** El modelo de datos ya anticipa esto (`sourceType: 'WHATSAPP'` en el schema, endpoint `POST /datos/submit` autenticado por API key en vez de JWT — pensado justo para que un sistema externo mande documentos). Falta el adaptador: un webhook que reciba mensajes de WhatsApp Business (vía Meta Cloud API) y los traduzca a una llamada a `submitDataViaApiKey`.

**Decisión de arquitectura:** cada `EmpresaConnection` va a tener un número de WhatsApp asociado (`whatsappPhoneNumber`, opcional — no todas las conexiones lo usan). El webhook resuelve "¿de qué conexión es este mensaje?" por el número de teléfono del remitente, no por API key en la URL (WhatsApp no permite mandar headers/query params custom). **Alcance de esta tarea: solo mensajes de TEXTO.** Los mensajes con imagen/audio de WhatsApp quedan fuera — Meta requiere un paso extra (descargar el media desde su Graph API con un token separado) que amerita su propia tarea; acá se guarda el texto tal cual, igual que cualquier entrada de texto libre del portal.

### Step 1: Migración — agregar `whatsappPhoneNumber` a `EmpresaConnection`

En `prisma/schema.prisma`, en el modelo `EmpresaConnection`, agregar el campo (después de `apiKey`):

```prisma
  whatsappPhoneNumber String?  @unique // formato E.164, ej "5493815551234". Null si no usa este canal.
```

Correr:
```bash
npx prisma migrate dev --name add_whatsapp_phone_to_connection
```

**Ojo con el drift-detection** (ya documentado en `docs/plans/2026-07-22-unify-learning-signals.md`): este repo tiene columnas `Unsupported()` (vector, tsvector) que Prisma no introspecciona del todo, así que `migrate dev` puede ofrecer "corregir" drift que no tiene nada que ver con este cambio (típicamente `DROP INDEX` en los índices de `vault_chunks`). Si eso pasa, abrí el `migration.sql` generado y dejá SOLO el `ALTER TABLE "empresa_connections" ADD COLUMN "whatsappPhoneNumber" ...` + su índice único — borrá cualquier otra sentencia a mano antes de aplicar.

Correr `npx prisma generate` después.

### Step 2: Endpoint para que el costista configure el número (test primero)

Crear `tests/application/empresa-connection-whatsapp.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  empresaConnection: { findFirst: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
};
vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));

beforeEach(() => vi.clearAllMocks());

describe('EmpresaConnectionService.setWhatsappNumber', () => {
  it('actualiza el número de WhatsApp de una conexión propia del costista', async () => {
    const { EmpresaConnectionService } = await import('@/application/empresa/empresa-connection-service.js');
    mockDb.empresaConnection.findFirst.mockResolvedValue({ id: 'conn-1', costistId: 'user-1' });
    mockDb.empresaConnection.update.mockResolvedValue({ id: 'conn-1', whatsappPhoneNumber: '5493815551234' });

    const svc = new EmpresaConnectionService(mockDb as never);
    const res = await svc.setWhatsappNumber('user-1', 'conn-1', '5493815551234');

    expect(mockDb.empresaConnection.findFirst).toHaveBeenCalledWith({
      where: { id: 'conn-1', costistId: 'user-1' },
    });
    expect(mockDb.empresaConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: { whatsappPhoneNumber: '5493815551234' },
    });
    expect(res.whatsappPhoneNumber).toBe('5493815551234');
  });

  it('rechaza si la conexión no es del costista (defensa en profundidad, mismo patrón que el resto del servicio)', async () => {
    const { EmpresaConnectionService } = await import('@/application/empresa/empresa-connection-service.js');
    mockDb.empresaConnection.findFirst.mockResolvedValue(null);

    const svc = new EmpresaConnectionService(mockDb as never);
    await expect(svc.setWhatsappNumber('user-1', 'conn-ajena', '5493815551234')).rejects.toThrow();
    expect(mockDb.empresaConnection.update).not.toHaveBeenCalled();
  });
});
```

Run: `npm test -- tests/application/empresa-connection-whatsapp.test.ts` → FAIL (el método no existe).

En `src/application/empresa/empresa-connection-service.ts`, leé el archivo completo primero (para ver el patrón exacto de `NotFoundError` y el constructor que ya usa el resto de la clase — probablemente ya tiene `constructor(private readonly db: PrismaClient = prisma) {}`). Agregar el método:

```ts
  async setWhatsappNumber(costistId: string, connectionId: string, phoneNumber: string) {
    const conn = await this.db.empresaConnection.findFirst({
      where: { id: connectionId, costistId },
    });
    if (!conn) throw new NotFoundError('Conexión no encontrada');

    return this.db.empresaConnection.update({
      where: { id: connectionId },
      data: { whatsappPhoneNumber: phoneNumber },
    });
  }
```

(Usá el mismo import de `NotFoundError` que ya tiene el archivo — no agregues uno nuevo si ya está.)

Run: `npm test -- tests/application/empresa-connection-whatsapp.test.ts` → PASS (2/2).

Agregar la ruta en `src/infrastructure/http/routes/validaciones.routes.ts` (donde ya están las rutas de `/conexiones/*`):

```ts
  app.put('/conexiones/:connectionId/whatsapp', { preHandler: authenticate }, async (request, reply) => {
    const { connectionId } = request.params as { connectionId: string };
    const { phoneNumber } = z.object({ phoneNumber: z.string().min(8).max(20) }).parse(request.body);
    const conn = await connSvc.setWhatsappNumber(request.authUser!.id, connectionId, phoneNumber);
    return reply.send({ data: conn });
  });
```

### Step 3: Config de entorno para el webhook

En `src/infrastructure/config/env.ts`, agregar (mismo patrón que `GROQ_API_KEY`/`VOYAGE_API_KEY` — placeholder por default para que el server arranque sin la key real en dev):

```ts
  WHATSAPP_VERIFY_TOKEN: z.string().min(1).default('whatsapp_verify_placeholder'),
```

### Step 4: El webhook — test primero

Crear `tests/http/whatsapp-webhook.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const mockConnService = {
  findByWhatsappNumber: vi.fn(),
  submitDataViaApiKey: vi.fn(),
};

vi.mock('@/infrastructure/config/env.js', () => ({
  getEnv: () => ({ WHATSAPP_VERIFY_TOKEN: 'test-verify-token' }),
}));

vi.mock('@/application/empresa/empresa-connection-service.js', () => ({
  EmpresaConnectionService: vi.fn().mockImplementation(() => mockConnService),
}));

import { registerWhatsappWebhookRoutes } from '@/infrastructure/http/routes/whatsapp-webhook.routes.js';

async function buildTestApp() {
  const app = Fastify();
  await registerWhatsappWebhookRoutes(app);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('GET /webhooks/whatsapp — verificación de Meta', () => {
  it('responde el challenge si el verify token coincide', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=1234',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('1234');
  });

  it('rechaza con 403 si el verify token no coincide', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=incorrecto&hub.challenge=1234',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /webhooks/whatsapp — mensaje entrante', () => {
  const META_PAYLOAD = {
    entry: [{
      changes: [{
        value: {
          messages: [{ from: '5493815551234', type: 'text', text: { body: 'Compré 10 chapas a $50.000' } }],
        },
      }],
    }],
  };

  it('resuelve la conexión por número de teléfono y crea el DataEntry', async () => {
    mockConnService.findByWhatsappNumber.mockResolvedValue({ id: 'conn-1', apiKey: 'key-abc' });
    mockConnService.submitDataViaApiKey.mockResolvedValue({ id: 'entry-1', status: 'PENDING' });

    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: META_PAYLOAD });

    expect(res.statusCode).toBe(200);
    expect(mockConnService.findByWhatsappNumber).toHaveBeenCalledWith('5493815551234');
    expect(mockConnService.submitDataViaApiKey).toHaveBeenCalledWith('key-abc', {
      rawContent: 'Compré 10 chapas a $50.000',
      sourceType: 'WHATSAPP',
    });
  });

  it('si el número no está vinculado a ninguna conexión, responde 200 igual (Meta reintenta si no es 200) pero no crea nada', async () => {
    mockConnService.findByWhatsappNumber.mockResolvedValue(null);

    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: META_PAYLOAD });

    expect(res.statusCode).toBe(200);
    expect(mockConnService.submitDataViaApiKey).not.toHaveBeenCalled();
  });

  it('ignora mensajes que no son de texto (imagen/audio) sin romper — quedan fuera de alcance', async () => {
    const payload = {
      entry: [{ changes: [{ value: { messages: [{ from: '5493815551234', type: 'image', image: { id: 'media-1' } }] } }] }],
    };
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload });

    expect(res.statusCode).toBe(200);
    expect(mockConnService.submitDataViaApiKey).not.toHaveBeenCalled();
  });
});
```

Run: `npm test -- tests/http/whatsapp-webhook.test.ts` → FAIL (el archivo de rutas no existe todavía).

Agregar `findByWhatsappNumber` a `EmpresaConnectionService` (mismo archivo de la Step 2):

```ts
  async findByWhatsappNumber(phoneNumber: string) {
    return this.db.empresaConnection.findUnique({
      where: { whatsappPhoneNumber: phoneNumber, isActive: true },
    });
  }
```

Nota: `findUnique` con un filtro compuesto que incluye un campo no-único (`isActive`) junto al único (`whatsappPhoneNumber`) es válido en Prisma (usa el índice único y filtra el resto en memoria/SQL). Si el linter de Prisma se queja, cambiá a `findFirst({ where: { whatsappPhoneNumber: phoneNumber, isActive: true } })` — funcionalmente idéntico acá porque el campo es `@unique`.

Crear `src/infrastructure/http/routes/whatsapp-webhook.routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../../config/env.js';
import { EmpresaConnectionService } from '../../../application/empresa/empresa-connection-service.js';

const verifyQuery = z.object({
  'hub.mode': z.string().optional(),
  'hub.verify_token': z.string().optional(),
  'hub.challenge': z.string().optional(),
});

interface MetaWebhookPayload {
  entry?: {
    changes?: {
      value?: {
        messages?: {
          from: string;
          type: string;
          text?: { body: string };
        }[];
      };
    }[];
  }[];
}

export async function registerWhatsappWebhookRoutes(app: FastifyInstance): Promise<void> {
  const connService = new EmpresaConnectionService();

  // Meta verifica el webhook una vez, al configurarlo, con un GET.
  app.get('/webhooks/whatsapp', async (request, reply) => {
    const q = verifyQuery.parse(request.query);
    const env = getEnv();
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === env.WHATSAPP_VERIFY_TOKEN) {
      return reply.status(200).send(q['hub.challenge'] ?? '');
    }
    return reply.status(403).send();
  });

  // Mensajes entrantes. Siempre respondemos 200 salvo error de nuestro lado —
  // si devolvemos otra cosa, Meta reintenta el mismo mensaje indefinidamente.
  app.post('/webhooks/whatsapp', async (request, reply) => {
    const payload = request.body as MetaWebhookPayload;
    const messages = payload.entry?.[0]?.changes?.[0]?.value?.messages ?? [];

    for (const msg of messages) {
      if (msg.type !== 'text' || !msg.text?.body) continue; // imagen/audio: fuera de alcance de esta tarea

      const conn = await connService.findByWhatsappNumber(msg.from);
      if (!conn) {
        console.warn(`[whatsapp-webhook] mensaje de un número no vinculado: ${msg.from}`);
        continue;
      }

      await connService.submitDataViaApiKey(conn.apiKey, {
        rawContent: msg.text.body,
        sourceType: 'WHATSAPP',
      });
    }

    return reply.status(200).send();
  });
}
```

Registrar la ruta en `src/infrastructure/http/app.ts` (buscá el bloque donde se registran las demás rutas, por ejemplo cerca de `registerEmpresaPortalRoutes`):

```ts
import { registerWhatsappWebhookRoutes } from './routes/whatsapp-webhook.routes.js';
// ...
      await registerWhatsappWebhookRoutes(api);
```

**Importante:** este endpoint NO lleva `{ preHandler: authenticate }` — Meta no manda un JWT nuestro, manda su propia verificación por `hub.verify_token` (el GET) y no manda ninguna auth en el POST de mensajes (esa es la razón por la que Meta exige que el endpoint esté en HTTPS público — la superficie de "cualquiera puede pegarle a este POST" ya existe hoy en `/datos/submit` con API key, y la resolución por `whatsappPhoneNumber` cumple el mismo rol acá: si el número no está vinculado a una conexión activa, no pasa nada).

### Step 5: Correr el test y verificar que pasa

Run: `npm test -- tests/http/whatsapp-webhook.test.ts`
Expected: PASS (5/5)

### Step 6: Suite completa + typecheck

Run: `npm test && npm run typecheck`
Expected: todo en verde.

### Step 7: Commit

```bash
git add prisma/schema.prisma prisma/migrations src/application/empresa/empresa-connection-service.ts src/infrastructure/config/env.ts src/infrastructure/http/routes/whatsapp-webhook.routes.ts src/infrastructure/http/routes/validaciones.routes.ts src/infrastructure/http/app.ts tests/application/empresa-connection-whatsapp.test.ts tests/http/whatsapp-webhook.test.ts
git commit -m "feat(whatsapp): adaptador de webhook para ingesta por WhatsApp (Meta Cloud API)"
```

### Step 8: Lo que falta para que esto funcione en producción (no es código, es configuración de cuenta — anotado para vos)

1. Dar de alta una app de Meta for Developers con el producto "WhatsApp Business Platform".
2. Configurar el webhook apuntando a `https://tu-backend.railway.app/webhooks/whatsapp`, con el mismo valor que pongas en `WHATSAPP_VERIFY_TOKEN` en Railway.
3. Cada costista, desde el frontend (falta el botón — anotado como fast-follow de UI, no de esta tarea backend), vincula el número de WhatsApp de su empresa a la conexión vía `PUT /conexiones/:connectionId/whatsapp`.

---

## Task 3: Caché para las llamadas al RAG (control de costo)

**Contexto:** `VaultQueryService.query()` no cachea nada — la misma pregunta preguntada dos veces (algo esperable: "¿qué es el ITCS?" la va a preguntar más de un costista) paga embedding + búsqueda + generación dos veces. Esta tarea agrega una caché en memoria con TTL, keyeada por la pregunta normalizada.

**Decisión de diseño:** caché en memoria (un `Map`), no en Postgres ni Redis — es más simple, y el peor caso (el proceso se reinicia y la caché se vacía) no rompe nada, solo vuelve a pagar el costo una vez. Si en el futuro el backend corre en múltiples instancias y hace falta compartir la caché entre procesos, se migra a Redis (que ya está en el stack, usado por BullMQ) sin cambiar el contrato del método.

### Step 1: Escribir el test que falla

Agregar a `tests/application/vault-query-service.test.ts` (el archivo que ya existe de la Fase 1), un `describe` nuevo al final del archivo:

```ts
describe('VaultQueryService.query — caché', () => {
  it('la misma pregunta dos veces solo pega una vez a embed/searchChunks/completeJSON', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockRepo.searchChunks.mockResolvedValue([CHUNK]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'El ITCS es la Tasa Integral de Costo Social.',
      citations: ['Costeo/ITCS.md'],
      answeredFromContext: true,
    });

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    const res1 = await svc.query('¿Qué es el ITCS?');
    const res2 = await svc.query('¿qué es el itcs?  '); // normalización: minúsculas + trim

    expect(res1).toEqual(res2);
    expect(mockEmbedder.embed).toHaveBeenCalledTimes(1);
    expect(mockRepo.searchChunks).toHaveBeenCalledTimes(1);
    expect(mockAi.completeJSON).toHaveBeenCalledTimes(1);
  });

  it('preguntas distintas no comparten caché', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockRepo.searchChunks.mockResolvedValue([CHUNK]);
    mockAi.completeJSON.mockResolvedValue({ answer: 'ok', citations: [], answeredFromContext: true });

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    await svc.query('¿Qué es el ITCS?');
    await svc.query('¿Qué es el PPP?');

    expect(mockEmbedder.embed).toHaveBeenCalledTimes(2);
  });
});
```

### Step 2: Correr el test y verificar que falla

Run: `npm test -- tests/application/vault-query-service.test.ts`
Expected: FAIL en el primer `it` de caché — hoy cada `query()` pega de nuevo.

### Step 3: Implementar la caché

En `src/application/vault-query/vault-query-service.ts`, el archivo hoy (post-Fase 1) tiene exactamente este contenido relevante — los cambios de abajo son diffs precisos contra ESE estado real, no genéricos.

Agregar, después del cierre de la interfaz `VaultQueryResult` (después de la línea `}` que cierra `fallbackMessage?: string;`) y antes de `const QA_SYSTEM_PROMPT = ...`:

```ts
/** TTL de la caché de respuestas del RAG: 1 hora. La bóveda no cambia tan seguido como para necesitar menos. */
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  result: VaultQueryResult;
  expiresAt: number;
}

/** Caché en memoria, a nivel de módulo: se comparte entre todas las instancias del servicio dentro del mismo proceso. */
const responseCache = new Map<string, CacheEntry>();

function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ');
}
```

En el método `query()`, cambiar el inicio de:

```ts
  async query(question: string, maxResults = 5): Promise<VaultQueryResult> {
    if (!this.embedder.isConfigured || !this.ai.isConfigured) {
      throw new UnprocessableEntityError('El servicio de IA o embeddings no está configurado (faltan API keys).');
    }

    // 1. Convertir pregunta a vector
```

a:

```ts
  async query(question: string, maxResults = 5): Promise<VaultQueryResult> {
    if (!this.embedder.isConfigured || !this.ai.isConfigured) {
      throw new UnprocessableEntityError('El servicio de IA o embeddings no está configurado (faltan API keys).');
    }

    const cacheKey = normalizeQuestion(question);
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    // 1. Convertir pregunta a vector
```

Y el final del método, de:

```ts
    // Si el match sólo apareció al ampliar el umbral, la confianza no puede ser HIGH
    // aunque el LLM haya podido responder con esos chunks.
    return {
      answer: result.answer,
      citations: verifiedCitations,
      confidence: result.answeredFromContext ? (usedWidenedSearch ? 'LOW' : 'HIGH') : 'LOW'
    };
  }
}
```

a:

```ts
    // Si el match sólo apareció al ampliar el umbral, la confianza no puede ser HIGH
    // aunque el LLM haya podido responder con esos chunks.
    const finalResult: VaultQueryResult = {
      answer: result.answer,
      citations: verifiedCitations,
      confidence: result.answeredFromContext ? (usedWidenedSearch ? 'LOW' : 'HIGH') : 'LOW'
    };
    responseCache.set(cacheKey, { result: finalResult, expiresAt: Date.now() + CACHE_TTL_MS });
    return finalResult;
  }
}
```

No hace falta renombrar nada más — la variable `result` de la respuesta del LLM (línea `const result = await this.ai.completeJSON<...>(...)`) y la `finalResult` nueva no chocan.

**No cachear los casos NONE/sin contexto** — ya está garantizado sin código extra: el `return` temprano de "sin chunks" pasa ANTES del punto donde se guarda en caché, así que ese camino nunca llega a `responseCache.set(...)`. (cuando no hay chunks o el LLM se niega): son exactamente las respuestas que ya generan una señal `RAG_MISS` para que el equipo mejore la bóveda — cachearlas escondería que la pregunta sigue sin respuesta la próxima vez que alguien la haga, y el nightly learning perdería la repetición como señal de "esto pasa seguido". Poné el `responseCache.set(...)` únicamente en el camino donde `chunks.length > 0` Y se llegó a invocar al LLM — no en los `return` tempranos de `NONE`.

### Step 4: Correr el test y verificar que pasa

Run: `npm test -- tests/application/vault-query-service.test.ts`
Expected: PASS (todos, incluidos los 2 nuevos de caché)

### Step 5: Suite completa + typecheck

Run: `npm test && npm run typecheck`

### Step 6: Commit

```bash
git add src/application/vault-query/vault-query-service.ts tests/application/vault-query-service.test.ts
git commit -m "feat(vault-query): cachear respuestas del RAG por 1 hora (control de costo)"
```

---

## Verificación final de la Fase 2

- [ ] `npm test` (backend) — toda la suite en verde.
- [ ] `npm run typecheck` (backend y frontend) — limpio.
- [ ] `npm run build` (frontend) — limpio.
- [ ] Recorrido manual: comparar dos períodos cerrados con datos de IPC cargados → aparece el contraste real. Mandar un mensaje de WhatsApp de prueba (o simular el webhook con `curl`) a un número vinculado → aparece como `DataEntry` pendiente en Validaciones. Preguntar lo mismo dos veces al chat del costista → la segunda respuesta es instantánea (caché).

## Fuera de este plan (no son código)

- Rol de DB dedicado en Railway sin `BYPASSRLS` (`prisma/rls.sql` ya existe, falta crearlo en la consola de Railway).
- Segundo entorno de staging (Railway + Vercel previews, ya decidido, falta aprovisionarlo).
- Documentar/agregar `CosteAR-admin` al flujo de deploy.
- Decidir `GET /macro/landing`: ¿lo consume `SKATT-landing` en algún momento, o se borra?
- Decidir el destino del código muerto `CREATE_ENTRY`/`CREATE_ALERT` del chat del costista.
