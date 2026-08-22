# Correcciones de la auditoría de IA/RAG — Fase 1 (backend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los hallazgos de mayor impacto de la auditoría del 2026-07-23: el chat del costista no usa el RAG de la bóveda, hay datos fabricados presentados como reales en el panel admin, un bug de un parámetro rompe el filtro de historial macro, y las piezas más críticas del RAG (la que responde en vivo) no tienen ni un test.

**Architecture:** Todos los cambios son aditivos sobre servicios existentes — no se reescribe el motor de cálculo ni se toca el contrato de ningún endpoint público. El patrón repetido es inyección de dependencias por constructor con default al singleton real (mismo patrón que ya usa `DataPointService`/`CostitaChatService` con `db`), para que cada pieza sea testeable sin tocar producción.

**Tech Stack:** Node 22, TypeScript, Fastify, Prisma, Vitest (mocks a mano vía `vi.mock`, sin librería de mocking), Groq (`llama-3.3-70b-versatile`), Voyage AI (embeddings), pgvector.

**Alcance de este documento:** Fase 1 = correcciones 100% de código en `CosteAR-backend` (+ un fix de una línea en `CosteAR-frontend`), todas verificables sin depender de decisiones de negocio externas. Las fases 2-3 (panel de "Variación de Costos País" con contraste macro, canal de ingesta por WhatsApp, separación de ambientes staging/producción) requieren decisiones del equipo (¿Twilio o Meta Cloud API? ¿presupuesto de un segundo entorno en Railway?) y se van a planificar aparte una vez definidas — ver la sección final "Fases futuras" de este documento.

---

## Task 1: `VAULT_QUESTION` — el chat del costista aprende a distinguir metodología de uso de la app

**Contexto:** `GroqCostitaChat` hoy está scopeado 100% a soporte técnico de la interfaz (`SYSTEM_PROMPT` se lo ordena explícitamente). Si un costista pregunta "¿qué es el ITCS?", el modelo no tiene instrucción para reconocerlo como pregunta de metodología — puede alucinar una respuesta con su conocimiento general, exactamente lo que el resto del sistema (RAG de la bóveda) existe para evitar. Esta tarea le enseña al clasificador de intención a devolver `actionType: "VAULT_QUESTION"` en vez de intentar responder él mismo.

**Files:**
- Modify: `src/infrastructure/ai/groq-costista-chat.ts`
- Test: `tests/ai/groq-costista-chat.test.ts` (nuevo)

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/ai/groq-costista-chat.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { groqFetchMock } = vi.hoisted(() => ({ groqFetchMock: vi.fn() }));

vi.mock('@/infrastructure/ai/groq-rate-limiter.js', () => ({
  groqFetch: groqFetchMock,
}));

vi.mock('@/infrastructure/config/env.js', () => ({
  getEnv: () => ({ GROQ_API_KEY: 'test-key-abcdefghij' }),
}));

import { GroqCostitaChat } from '@/infrastructure/ai/groq-costista-chat.js';

function ok(content: unknown) {
  const body = typeof content === 'string' ? content : JSON.stringify(content);
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: body } }] }),
    text: async () => body,
  };
}

function systemMessageOf(callIndex: number): string {
  const init = groqFetchMock.mock.calls[callIndex][1] as { body: string };
  const body = JSON.parse(init.body) as { messages: { role: string; content: unknown }[] };
  return (body.messages.find((m) => m.role === 'system')?.content as string) ?? '';
}

const PORTFOLIO = { companies: [], pendingCount: 0, activeAlerts: 0 };

beforeEach(() => {
  groqFetchMock.mockReset();
});

describe('GroqCostitaChat — VAULT_QUESTION', () => {
  it('el system prompt instruye distinguir preguntas de metodología de costeo', async () => {
    groqFetchMock.mockResolvedValueOnce(
      ok({ reply: '', actionType: 'VAULT_QUESTION', confidence: 100, proposedEntry: null, proposedAlert: null }),
    );

    const chat = new GroqCostitaChat();
    await chat.interpret('¿Qué es el ITCS?', PORTFOLIO);

    const sys = systemMessageOf(0);
    expect(sys).toContain('VAULT_QUESTION');
    expect(sys).toContain('METODOLOGÍA DE COSTEO');
  });

  it('cuando Groq devuelve VAULT_QUESTION, interpret() lo pasa sin modificar', async () => {
    groqFetchMock.mockResolvedValueOnce(
      ok({ reply: '', actionType: 'VAULT_QUESTION', confidence: 100, proposedEntry: null, proposedAlert: null }),
    );

    const chat = new GroqCostitaChat();
    const res = await chat.interpret('¿Cómo se calcula el PPP?', PORTFOLIO);

    expect(res?.actionType).toBe('VAULT_QUESTION');
    expect(res?.reply).toBe('');
  });

  it('preguntas de uso de la app siguen devolviendo INFO_ONLY (sin regresión)', async () => {
    groqFetchMock.mockResolvedValueOnce(
      ok({
        reply: 'Andá a la pestaña Clientes y hacé clic en Nueva Empresa.',
        actionType: 'INFO_ONLY',
        confidence: 100,
        proposedEntry: null,
        proposedAlert: null,
      }),
    );

    const chat = new GroqCostitaChat();
    const res = await chat.interpret('¿Cómo doy de alta una empresa?', PORTFOLIO);

    expect(res?.actionType).toBe('INFO_ONLY');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/ai/groq-costista-chat.test.ts`
Expected: FAIL en el primer test — `sys` no contiene `'VAULT_QUESTION'` ni `'METODOLOGÍA DE COSTEO'` porque el prompt todavía no los menciona. (El segundo test probablemente pase igual, porque `interpret()` hoy no valida `actionType` contra un enum — es solo un `as CostitaChatResponse`. Esperado: al menos el primer `it` en rojo.)

- [ ] **Step 3: Actualizar el tipo y el `SYSTEM_PROMPT`**

En `src/infrastructure/ai/groq-costista-chat.ts`, cambiar la línea 22:

```ts
export type ChatActionType = 'CREATE_ENTRY' | 'CREATE_ALERT' | 'INFO_ONLY' | 'VAULT_QUESTION';
```

Y reemplazar el bloque del `SYSTEM_PROMPT` (líneas 63-85) por:

```ts
const SYSTEM_PROMPT = `Sos el Asistente de Soporte Técnico de CosteAR. Tu único rol es responder preguntas de ayuda sobre cómo usar y operar la aplicación web CosteAR.

No debés proponer registrar asientos, facturas, transacciones o alertas automáticas. Toda respuesta debe ser puramente informativa e instructiva sobre la interfaz, los menús, las pestañas y el flujo de uso de la aplicación.

Temas de soporte técnico sobre cómo operar la aplicación:
1. Cómo dar de alta una nueva empresa cliente en la pestaña "Clientes" y cómo editar o eliminar empresas.
2. Cómo crear una estructura de costos e ingresar los parámetros de Materia Prima (ficha PPP, política de stock), Mano de Obra Directa (días hábiles, cargas sociales e ITCS), y Costos Indirectos (prorrateo dual fijo/variable por centro productivo y de servicio).
3. Cómo invitar a un operador para que cargue los datos de una empresa en el "Portal de Operadores" o revocar su acceso.
4. Cómo consultar y cargar transacciones en el Libro de Costos de cada empresa, y cómo exportar los reportes de cálculo a Excel.
5. Cómo leer la tabla de variaciones de costos indirectos (CIP) y analizar los resultados en la pestaña "Resultado".

Además de estos temas de soporte, los costistas a veces preguntan sobre METODOLOGÍA DE COSTEO en sí (por ejemplo: "¿qué es el ITCS?", "¿cómo se calcula el PPP?", "¿qué es la capacidad ociosa?", "¿cómo funciona el prorrateo secundario escalonado?"). Esas preguntas NO las respondas vos: no sabés la metodología exacta de la cátedra y inventar una respuesta sería peligroso para un costista que confía en el número. Para esas preguntas, devolvé "actionType": "VAULT_QUESTION" con "reply": "" — un componente separado del sistema va a buscar la respuesta real en la Bóveda de Conocimiento. Usá VAULT_QUESTION únicamente para preguntas de METODOLOGÍA/TEORÍA de costos, nunca para preguntas de "cómo uso la app" (esas siguen siendo INFO_ONLY con los 5 temas de arriba).

Reglas de formato de respuesta:
- Respondé de forma amable, concisa y en español rioplatense (máximo 4 oraciones).
- Siempre retorná un JSON con "proposedEntry" y "proposedAlert" como null.

Ejemplo de respuesta para soporte de uso de la app:
{
  "reply": "Para invitar a un operador, andá a la pestaña 'Personal Autorizado' dentro de los detalles del cliente y hacé clic en 'Invitar Operador'. Ingresá su email y el sistema le enviará un código de acceso.",
  "actionType": "INFO_ONLY",
  "confidence": 100,
  "proposedEntry": null,
  "proposedAlert": null
}

Ejemplo de respuesta para una pregunta de metodología de costeo:
{
  "reply": "",
  "actionType": "VAULT_QUESTION",
  "confidence": 100,
  "proposedEntry": null,
  "proposedAlert": null
}`;
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/ai/groq-costista-chat.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: sin errores (el `ChatActionType` ampliado no rompe nada porque todavía nadie en el código restringe ese union — se restringe recién en la Task 2).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/ai/groq-costista-chat.ts tests/ai/groq-costista-chat.test.ts
git commit -m "feat(chat): distinguir preguntas de metodologia de costeo (VAULT_QUESTION)"
```

---

## Task 2: `CostitaChatService` enruta `VAULT_QUESTION` al RAG real de la bóveda

**Contexto:** Con el tipo ya definido (Task 1), falta que el servicio de aplicación efectivamente llame a `VaultQueryService` (el RAG con pgvector + Voyage + Groq, anti-alucinación, ya construido y probado en producción) cuando el chat del costista detecta una pregunta de metodología. Hoy `CostitaChatService` instancia `GroqCostitaChat` como singleton de módulo, no inyectable — se refactoriza a inyección por constructor (mismo patrón que `db`) para poder testear sin pegarle a la red.

**Files:**
- Modify: `src/application/costista-chat/costista-chat-service.ts`
- Test: `tests/application/costista-chat-service.test.ts` (nuevo)

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/application/costista-chat-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  dailySignal: { create: vi.fn() },
  company: { findMany: vi.fn(), findFirst: vi.fn() },
  dataEntry: { count: vi.fn(), create: vi.fn() },
  alert: { count: vi.fn(), create: vi.fn() },
  macroSnapshot: { findMany: vi.fn() },
  empresaConnection: { findFirst: vi.fn(), create: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));

const mockChat = { isConfigured: true, interpret: vi.fn() };
const mockVaultQuery = { query: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.company.findMany.mockResolvedValue([]);
  mockDb.dataEntry.count.mockResolvedValue(0);
  mockDb.alert.count.mockResolvedValue(0);
  mockDb.macroSnapshot.findMany.mockResolvedValue([]);
  mockChat.isConfigured = true;
});

describe('CostitaChatService.interpret — ruteo VAULT_QUESTION al RAG', () => {
  it('cuando el chat devuelve VAULT_QUESTION, consulta el RAG de la bóveda (no al LLM genérico de nuevo)', async () => {
    const { CostitaChatService } = await import('@/application/costista-chat/costista-chat-service.js');
    mockChat.interpret.mockResolvedValue({ reply: '', actionType: 'VAULT_QUESTION', confidence: 100 });
    mockVaultQuery.query.mockResolvedValue({
      answer: 'El ITCS es la Tasa Integral de Costo Social...',
      citations: ['Costeo/ITCS.md'],
      confidence: 'HIGH',
    });

    const svc = new CostitaChatService(mockDb as never, mockChat as never, mockVaultQuery as never);
    const res = await svc.interpret('user-1', { message: '¿Qué es el ITCS?' });

    expect(mockVaultQuery.query).toHaveBeenCalledWith('¿Qué es el ITCS?');
    expect(res.actionType).toBe('INFO_ONLY');
    expect(res.reply).toContain('El ITCS es la Tasa Integral de Costo Social');
    expect(res.reply).toContain('Costeo/ITCS.md');
    expect(res.confidence).toBe(90);
  });

  it('cuando el chat devuelve INFO_ONLY (pregunta de uso de la app), nunca llama al RAG de la bóveda', async () => {
    const { CostitaChatService } = await import('@/application/costista-chat/costista-chat-service.js');
    mockChat.interpret.mockResolvedValue({
      reply: 'Andá a la pestaña Clientes...',
      actionType: 'INFO_ONLY',
      confidence: 100,
    });

    const svc = new CostitaChatService(mockDb as never, mockChat as never, mockVaultQuery as never);
    const res = await svc.interpret('user-1', { message: '¿Cómo cargo una empresa?' });

    expect(mockVaultQuery.query).not.toHaveBeenCalled();
    expect(res.actionType).toBe('INFO_ONLY');
  });

  it('si el RAG de la bóveda falla, cae a un mensaje seguro y registra ASSISTANT_MISS', async () => {
    const { CostitaChatService } = await import('@/application/costista-chat/costista-chat-service.js');
    mockChat.interpret.mockResolvedValue({ reply: '', actionType: 'VAULT_QUESTION', confidence: 100 });
    mockVaultQuery.query.mockRejectedValue(new Error('IA no configurada'));

    const svc = new CostitaChatService(mockDb as never, mockChat as never, mockVaultQuery as never);
    const res = await svc.interpret('user-1', { message: '¿Qué es el ITCS?' });

    expect(res.actionType).toBe('INFO_ONLY');
    expect(res.confidence).toBe(0);
    expect(mockDb.dailySignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'ASSISTANT_MISS', source: 'COSTISTA_CHAT' }),
      }),
    );
  });

  it('confianza LOW del RAG se mapea a 50, NONE a 0', async () => {
    const { CostitaChatService } = await import('@/application/costista-chat/costista-chat-service.js');
    mockChat.interpret.mockResolvedValue({ reply: '', actionType: 'VAULT_QUESTION', confidence: 100 });
    mockVaultQuery.query.mockResolvedValue({ answer: 'Respuesta parcial', citations: [], confidence: 'LOW' });

    const svc = new CostitaChatService(mockDb as never, mockChat as never, mockVaultQuery as never);
    const res = await svc.interpret('user-1', { message: 'algo ambiguo' });

    expect(res.confidence).toBe(50);
    expect(res.reply).toBe('Respuesta parcial');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/application/costista-chat-service.test.ts`
Expected: FAIL — `CostitaChatService` todavía no acepta un segundo/tercer parámetro de constructor, así que `mockChat.interpret` nunca se usa (el servicio sigue llamando al singleton real `groqChat`, que no está mockeado) y `mockVaultQuery.query` nunca se invoca.

- [ ] **Step 3: Refactorizar `CostitaChatService` para inyectar `chat` y `vaultQuery`, y enrutar `VAULT_QUESTION`**

En `src/application/costista-chat/costista-chat-service.ts`, agregar el import:

```ts
import { VaultQueryService, type VaultQueryResult } from '../vault-query/vault-query-service.js';
```

Cambiar el constructor (línea 34) de:

```ts
export class CostitaChatService {
  constructor(private readonly db: PrismaClient = prisma) {}
```

a:

```ts
export class CostitaChatService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly chat: GroqCostitaChat = groqChat,
    private readonly vaultQuery: VaultQueryService = new VaultQueryService(),
  ) {}
```

Reemplazar el método `interpret` completo (líneas 90-136) por:

```ts
  async interpret(
    userId: string,
    input: InterpretInput,
  ): Promise<CostitaChatResponse> {
    const portfolio = await this.buildPortfolioContext(userId);

    const fallback: CostitaChatResponse = {
      reply: 'Por el momento no puedo interpretar eso. Probá con otra consulta.',
      actionType: 'INFO_ONLY',
      confidence: 0,
    };

    if (!this.chat.isConfigured) return fallback;

    try {
      const result = await this.chat.interpret(
        input.message,
        portfolio,
        input.conversationHistory ?? [],
      );

      if (!result) {
        await this.db.dailySignal.create({
          data: {
            type: 'ASSISTANT_MISS',
            source: 'COSTISTA_CHAT',
            content: input.message,
            context: { reason: 'LLM returned empty or invalid response' },
            userId
          }
        });
        return fallback;
      }

      if (result.actionType === 'VAULT_QUESTION') {
        return await this.answerFromVault(userId, input.message);
      }

      return result;
    } catch (err: any) {
      await this.db.dailySignal.create({
        data: {
          type: 'ASSISTANT_MISS',
          source: 'COSTISTA_CHAT',
          content: input.message,
          context: { reason: 'Exception during interpret', error: err.message },
          userId
        }
      });
      return fallback;
    }
  }

  /**
   * Responde una pregunta de metodología de costeo usando el RAG de la bóveda
   * (VaultQueryService, con anti-alucinación), no el LLM genérico del chat.
   * Si el RAG falla, cae a un mensaje seguro y registra la falla — nunca
   * deja que un error de red se propague al costista como un 500.
   */
  private async answerFromVault(userId: string, message: string): Promise<CostitaChatResponse> {
    try {
      const vaultResult = await this.vaultQuery.query(message);
      const citationsText = vaultResult.citations.length > 0
        ? `\n\nFuentes: ${vaultResult.citations.join(', ')}`
        : '';
      const confidenceMap: Record<VaultQueryResult['confidence'], number> = {
        HIGH: 90,
        LOW: 50,
        NONE: 0,
      };
      return {
        reply: vaultResult.answer + citationsText,
        actionType: 'INFO_ONLY',
        confidence: confidenceMap[vaultResult.confidence],
      };
    } catch (err: any) {
      await this.db.dailySignal.create({
        data: {
          type: 'ASSISTANT_MISS',
          source: 'COSTISTA_CHAT',
          content: message,
          context: { reason: 'VaultQueryService threw', error: err.message },
          userId,
        },
      });
      return {
        reply: 'No pude consultar la bóveda de costeo en este momento. Probá de nuevo en unos minutos.',
        actionType: 'INFO_ONLY',
        confidence: 0,
      };
    }
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/application/costista-chat-service.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Correr la suite completa (no regresión) y typecheck**

Run: `npm test && npm run typecheck`
Expected: todos los tests existentes en verde (el constructor sigue aceptando cero argumentos gracias a los defaults — ningún caller existente de `new CostitaChatService()` se rompe).

- [ ] **Step 6: Commit**

```bash
git add src/application/costista-chat/costista-chat-service.ts tests/application/costista-chat-service.test.ts
git commit -m "feat(chat): conectar el chat del costista al RAG real de la boveda"
```

- [ ] **Step 7: Verificación manual en navegador**

Con `docker-compose up -d`, `npm run dev` (backend) y `npm run dev` (frontend) levantados y `GROQ_API_KEY`/`VOYAGE_API_KEY` reales configuradas: abrir el dashboard del costista, abrir "Asistente CosteAR", escribir "¿Qué es el ITCS?" y confirmar que la respuesta cita un archivo de la bóveda (ej. `Costeo/ITCS.md`) en vez de una explicación genérica. Después preguntar "¿Cómo invito a un operador?" y confirmar que sigue respondiendo la guía de uso de siempre (sin regresión).

---

## Task 3: Sacar datos fabricados del panel admin (MRR inventado)

**Contexto:** `AdminOverview.tsx` (repo `CosteAR-admin`) muestra un MRR calculado como `totalUsers * 49.99` con el comentario propio `// Mocked... for demo purposes`, más un badge fijo "+12.5%" que tampoco sale de ningún dato real. Es el mismo antipatrón que el equipo ya identificó y corrigió en el dashboard del costista (el panel "Variación de Costos País" con datos inventados, eliminado el 2026-07-13 por la misma razón). No existe todavía un sistema de facturación/suscripciones real en el código — no hay con qué calcular un MRR verdadero, así que la corrección correcta es sacar la tarjeta, no maquillarla.

**Files:**
- Modify: `CosteAR-admin/src/features/admin/components/AdminOverview.tsx:10-46,`~`96` (grid de la sección 1)

- [ ] **Step 1: Confirmar que no hay otro consumidor de esa tarjeta**

Run (en `CosteAR-admin`): esta búsqueda no debe encontrar nada fuera de este archivo:
```bash
grep -rn "mrr\|MRR" src --include="*.tsx" --include="*.ts"
```
Expected: solo coincidencias dentro de `AdminOverview.tsx`.

- [ ] **Step 2: Quitar la tarjeta de MRR y la variable que la alimenta**

En `src/features/admin/components/AdminOverview.tsx`, eliminar la línea 14-15:

```ts
  // Mocked MRR calculation based on total users for demo purposes
  const mrr = (stats?.saas.totalUsers || 0) * 49.99; 
```

Eliminar el bloque completo de la "MRR Card" (el `<Card>` que va desde el comentario `{/* MRR Card */}` hasta su `</Card>` de cierre, líneas 26-46 del archivo original).

Cambiar el grid de la Sección 1 de 3 a 2 columnas — la línea:

```tsx
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
```

pasa a:

```tsx
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
```

Quedan solo la "Users Card" (`stats?.saas.totalUsers`, dato real) y la "Activity Card" (`stats?.saas.activeUsersToday`, dato real).

Ya no se usa el ícono `DollarSign` ni `TrendingUp` si no aparecen en otro lado del archivo — verificar con:
```bash
grep -n "DollarSign\|TrendingUp" src/features/admin/components/AdminOverview.tsx
```
Si no hay más coincidencias que la línea del `import`, sacarlos del import de `lucide-react` (línea 4-7) para que el linter no marque imports sin usar.

- [ ] **Step 3: Typecheck y build**

Run: `npm run typecheck && npm run build`
Expected: sin errores. `npm run lint` (si existe el script) tampoco debe marcar imports no usados.

- [ ] **Step 4: Commit**

```bash
git add src/features/admin/components/AdminOverview.tsx
git commit -m "fix(admin): sacar el MRR inventado del panel de metricas de negocio"
```

---

## Task 4: Borrar el componente admin huérfano con datos personales hardcodeados

**Contexto:** `AdminUsersPlaceholder.tsx` no lo importa ningún otro archivo del repo (confirmado por grep — solo se referencia a sí mismo) y tiene nombre/email reales hardcodeados de una iteración anterior. Es código muerto con un problema de higiene de datos personales.

**Files:**
- Delete: `CosteAR-admin/src/features/admin/components/AdminUsersPlaceholder.tsx`

- [ ] **Step 1: Confirmar que sigue sin uso (por si algo cambió desde la auditoría)**

Run (en `CosteAR-admin`):
```bash
grep -rn "AdminUsersPlaceholder" src router.tsx 2>/dev/null
```
Expected: la única coincidencia es la línea `export function AdminUsersPlaceholder()` dentro del propio archivo. Si aparece algún `import` desde otro archivo, PARAR esta tarea y avisar — significaría que se empezó a usar después de la auditoría.

- [ ] **Step 2: Borrar el archivo**

```bash
git rm src/features/admin/components/AdminUsersPlaceholder.tsx
```

- [ ] **Step 3: Typecheck y build**

Run: `npm run typecheck && npm run build`
Expected: sin errores (confirma que de verdad no lo importaba nadie).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(admin): borrar componente placeholder sin uso con datos personales hardcodeados"
```

---

## Task 5: Confirmar y borrar el archivo huérfano en la raíz del workspace

**Contexto:** `C:\Users\giuli\Documents\CosteAR\CompanyDetailPage.tsx` (962 líneas) está fuera de cualquiera de los 3 repos (`CosteAR-backend`, `CosteAR-frontend`, `CosteAR-admin`), en la raíz del workspace. Parece un archivo de trabajo/backup olvidado de una sesión anterior — no forma parte del build de ningún repo. Esto toca un archivo fuera de control de versiones de ningún repo git conocido, así que **esta tarea requiere confirmación explícita de Giuliana antes de borrar**, no se ejecuta como parte de un flujo automático.

**Files:**
- Delete (con confirmación previa): `C:\Users\giuli\Documents\CosteAR\CompanyDetailPage.tsx`

- [ ] **Step 1: Verificar que no es la fuente de verdad de ningún componente activo**

```bash
diff "C:\Users\giuli\Documents\CosteAR\CompanyDetailPage.tsx" "C:\Users\giuli\Documents\CosteAR\CosteAR-frontend\src\features\companies\CompanyDetailPage.tsx"
```

Si el diff muestra que el archivo de la raíz es una versión más VIEJA o distinta del que sí está en el repo (`CosteAR-frontend/src/features/companies/CompanyDetailPage.tsx`), es evidencia adicional de que es un descarte de una sesión anterior.

- [ ] **Step 2: Preguntar a Giuliana antes de borrar**

No ejecutar el `rm`/`Remove-Item` sin una confirmación explícita en el chat — es un archivo fuera de cualquier repo git, sin `git status`/`git diff` que respalde la reversión si es un error.

- [ ] **Step 3 (solo tras confirmación): borrar**

```powershell
Remove-Item "C:\Users\giuli\Documents\CosteAR\CompanyDetailPage.tsx" -Confirm:$false
```

---

## Task 6: Fix de una línea — `useMacroHistory` manda el parámetro equivocado

**Contexto:** El frontend manda `indicatorCode` como query param; el backend (`macro.routes.ts:9`) lo lee como `indicator`. El filtro por indicador se ignora en silencio — `MacroRiskPanel` funciona "por casualidad" hoy porque solo hay un indicador cargado, pero se rompe apenas se agregue un segundo indicador histórico.

**Files:**
- Modify: `CosteAR-frontend/src/features/alerts/alert-hooks.ts:22`

- [ ] **Step 1: Aplicar el fix**

En `src/features/alerts/alert-hooks.ts`, dentro de `useMacroHistory`, cambiar:

```ts
      const res = await api.get<{ data: MacroSnapshot[] }>('/macro/history', {
        params: { indicatorCode },
      });
```

a:

```ts
      const res = await api.get<{ data: MacroSnapshot[] }>('/macro/history', {
        params: { indicator: indicatorCode },
      });
```

(Solo cambia la clave que viaja en la query string — el nombre del parámetro de la función `indicatorCode` no se toca, así que ningún caller de `useMacroHistory(...)` en el resto del código necesita cambios.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Verificación manual en navegador (no hay infraestructura de test de hooks en este repo — RTL/jsdom no están instalados, ver `DECISIONES.md`)**

Con el backend local levantado y al menos un `MacroSnapshot` cargado (`db:seed` o carga manual desde `/macro/manual-entry`):
1. Abrir el dashboard, ir a la sección de riesgo macro (`MacroRiskPanel`).
2. Abrir DevTools → Network, filtrar por `macro/history`.
3. Confirmar que la query string del request es `?indicator=USD_OFICIAL` (no `?indicatorCode=USD_OFICIAL`).
4. Confirmar que el backend responde `200` con datos filtrados (no el historial completo sin filtrar).

- [ ] **Step 4: Commit**

```bash
git add src/features/alerts/alert-hooks.ts
git commit -m "fix(macro): corregir el nombre del query param que rompia el filtro de indicador"
```

---

## Task 7: `VaultQueryService` — inyección de dependencias + suite de tests (hoy en cero)

**Contexto:** `VaultQueryService` es la pieza más crítica del RAG (la que responde en tiempo real a preguntas del costista, con la garantía de "cero alucinaciones") y hoy no tiene ni un test automatizado — al contrario del indexador y el clasificador, que sí están cubiertos. Antes de poder testearla hay que hacerla inyectable (mismo patrón DI que el resto del código ya usa).

**Files:**
- Modify: `src/application/vault-query/vault-query-service.ts`
- Test: `tests/application/vault-query-service.test.ts` (nuevo)

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/application/vault-query-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = { dailySignal: { create: vi.fn() } };
vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));

const mockEmbedder = { isConfigured: true, embed: vi.fn() };
const mockAi = { isConfigured: true, completeJSON: vi.fn() };
const mockRepo = { searchChunks: vi.fn() };

const CHUNK = {
  sourceFile: 'Costeo/ITCS.md',
  headingPath: 'ITCS > Definición',
  content: 'El ITCS es la Tasa Integral de Costo Social...',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbedder.isConfigured = true;
  mockAi.isConfigured = true;
  mockEmbedder.embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
});

describe('VaultQueryService.query', () => {
  it('responde con confianza HIGH cuando hay match directo (umbral 0.65) y el LLM contesta desde el contexto', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockRepo.searchChunks.mockResolvedValueOnce([CHUNK]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'El ITCS es la Tasa Integral de Costo Social.',
      citations: ['Costeo/ITCS.md'],
      answeredFromContext: true,
    });

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    const res = await svc.query('¿Qué es el ITCS?');

    expect(res.confidence).toBe('HIGH');
    expect(res.answer).toBe('El ITCS es la Tasa Integral de Costo Social.');
    expect(res.citations).toEqual(['Costeo/ITCS.md']);
    expect(mockRepo.searchChunks).toHaveBeenCalledTimes(1);
    expect(mockRepo.searchChunks).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5, 0.65);
  });

  it('filtra citas alucinadas: si el LLM cita un archivo que no estaba en el contexto, se descarta', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockRepo.searchChunks.mockResolvedValueOnce([CHUNK]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'El ITCS es...',
      citations: ['Costeo/ITCS.md', 'Costeo/Archivo-Inventado.md'],
      answeredFromContext: true,
    });

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    const res = await svc.query('¿Qué es el ITCS?');

    expect(res.citations).toEqual(['Costeo/ITCS.md']);
  });

  it('reintenta con umbral ampliado (0.85) si no hay match directo, y marca confianza LOW', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockRepo.searchChunks
      .mockResolvedValueOnce([])       // primer intento, umbral 0.65
      .mockResolvedValueOnce([CHUNK]); // segundo intento, umbral 0.85
    mockAi.completeJSON.mockResolvedValue({
      answer: 'El ITCS es...',
      citations: ['Costeo/ITCS.md'],
      answeredFromContext: true,
    });

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    const res = await svc.query('ITCS');

    expect(mockRepo.searchChunks).toHaveBeenCalledTimes(2);
    expect(mockRepo.searchChunks).toHaveBeenNthCalledWith(2, [0.1, 0.2, 0.3], 5, 0.85);
    expect(res.confidence).toBe('LOW');
  });

  it('sin chunks en ningún umbral: responde negativa, confianza NONE, y registra RAG_MISS', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockRepo.searchChunks.mockResolvedValue([]);

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    const res = await svc.query('pregunta sin relación con costeo');

    expect(res.confidence).toBe('NONE');
    expect(res.citations).toEqual([]);
    expect(mockAi.completeJSON).not.toHaveBeenCalled();
    expect(mockDb.dailySignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'RAG_MISS', source: 'COSTISTA_CHAT' }),
      }),
    );
  });

  it('si el LLM se niega (answeredFromContext=false), confianza LOW, sin citas, y registra RAG_MISS', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockRepo.searchChunks.mockResolvedValueOnce([CHUNK]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'No tengo información suficiente en la bóveda para responder eso.',
      citations: [],
      answeredFromContext: false,
    });

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    const res = await svc.query('¿Cuál es el mejor color para el logo?');

    expect(res.confidence).toBe('LOW');
    expect(res.citations).toEqual([]);
    expect(mockDb.dailySignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'RAG_MISS', context: { reason: 'LLM generated refusal (answeredFromContext=false)' } }),
      }),
    );
  });

  it('lanza UnprocessableEntityError si Voyage o Groq no están configurados', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockEmbedder.isConfigured = false;

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    await expect(svc.query('¿Qué es el ITCS?')).rejects.toThrow(/no está configurado/);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/application/vault-query-service.test.ts`
Expected: FAIL en todos los `it` — el constructor de `VaultQueryService` hoy no acepta argumentos, así que `new VaultQueryService(mockEmbedder as never, ...)` construye la clase ignorando los mocks (TypeScript no se queja porque el constructor actual no tiene parámetros, pero en runtime el servicio sigue usando `new VoyageService()`/`new GroqService()`/`new PrismaVaultChunkRepository()` reales, que van a fallar por falta de red/DB en el entorno de test).

- [ ] **Step 3: Hacer `VaultQueryService` inyectable**

En `src/application/vault-query/vault-query-service.ts`, cambiar el constructor (líneas 37-41) de:

```ts
export class VaultQueryService {
  private readonly embedder: VoyageService;
  private readonly ai: GroqService;
  private readonly repo: PrismaVaultChunkRepository;

  constructor() {
    this.embedder = new VoyageService();
    this.ai = new GroqService();
    this.repo = new PrismaVaultChunkRepository();
  }
```

a:

```ts
export class VaultQueryService {
  constructor(
    private readonly embedder: VoyageService = new VoyageService(),
    private readonly ai: GroqService = new GroqService(),
    private readonly repo: PrismaVaultChunkRepository = new PrismaVaultChunkRepository(),
  ) {}
```

(El resto de la clase no cambia — todos los usos son `this.embedder`/`this.ai`/`this.repo`, que siguen funcionando igual.)

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/application/vault-query-service.test.ts`
Expected: PASS (6/6)

- [ ] **Step 5: Correr la suite completa y typecheck**

Run: `npm test && npm run typecheck`
Expected: todo en verde — ningún caller existente de `new VaultQueryService()` (incluida la Task 2 de este plan) se rompe, porque los tres parámetros nuevos tienen default.

- [ ] **Step 6: Commit**

```bash
git add src/application/vault-query/vault-query-service.ts tests/application/vault-query-service.test.ts
git commit -m "test(vault-query): hacer VaultQueryService inyectable y cubrir el RAG con tests"
```

---

## Task 8: Control de costo — capar el tamaño del contexto del RAG

**Contexto:** Hoy `vault-query-service.ts` arma `contextStr` concatenando hasta 5 chunks sin ningún límite de caracteres. Con `maxResults=5` el riesgo actual es bajo, pero es la única defensa — si en el futuro se sube `maxResults` o aparecen notas muy largas en la bóveda, no hay ningún techo. Se agrega un cap defensivo, barato de implementar ahora.

**Files:**
- Modify: `src/application/vault-query/vault-query-service.ts`
- Test: `tests/application/vault-query-service.test.ts` (agregar un `it` a la suite de la Task 7)

- [ ] **Step 1: Escribir el test que falla**

Agregar al final del `describe('VaultQueryService.query', ...)` en `tests/application/vault-query-service.test.ts`:

```ts
  it('capa el contexto a MAX_CONTEXT_CHARS antes de armar el prompt del LLM', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    const hugeChunk = { ...CHUNK, content: 'x'.repeat(20_000) };
    mockRepo.searchChunks.mockResolvedValueOnce([hugeChunk, hugeChunk, hugeChunk]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'ok',
      citations: [],
      answeredFromContext: true,
    });

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    await svc.query('pregunta con contexto enorme');

    const [, userPrompt] = mockAi.completeJSON.mock.calls[0] as [string, string];
    // El contexto (extraído del userPrompt, después de "CONTEXTO:\n") no puede superar el cap.
    const contextPart = userPrompt.split('CONTEXTO:\n')[1] ?? '';
    expect(contextPart.length).toBeLessThanOrEqual(12_000 + 200); // + margen para el marcador de corte
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/application/vault-query-service.test.ts`
Expected: FAIL — con 3 chunks de 20.000 caracteres cada uno, `contextPart.length` es ~60.000+, muy por encima del cap esperado.

- [ ] **Step 3: Implementar el cap**

En `src/application/vault-query/vault-query-service.ts`, agregar la constante después de los imports (línea 6):

```ts
/** Techo defensivo de caracteres del contexto armado para el prompt del RAG. */
const MAX_CONTEXT_CHARS = 12_000;
```

Y reemplazar el bloque de armado de contexto (líneas 89-96):

```ts
    // 3. Armado del prompt con el contexto
    let contextStr = '';
    let i = 1;
    for (const c of chunks) {
      const heading = c.headingPath ? ` > ${c.headingPath}` : '';
      contextStr += `[Chunk ${i}] Fuente: ${c.sourceFile}${heading}\n${c.content}\n\n`;
      i++;
    }
```

por:

```ts
    // 3. Armado del prompt con el contexto (capado como defensa en profundidad —
    // maxResults ya acota la cantidad de chunks, esto acota el tamaño total).
    let contextStr = '';
    let i = 1;
    for (const c of chunks) {
      const heading = c.headingPath ? ` > ${c.headingPath}` : '';
      contextStr += `[Chunk ${i}] Fuente: ${c.sourceFile}${heading}\n${c.content}\n\n`;
      i++;
    }
    if (contextStr.length > MAX_CONTEXT_CHARS) {
      console.warn(`[vault-query] Contexto truncado de ${contextStr.length} a ${MAX_CONTEXT_CHARS} caracteres.`);
      contextStr = contextStr.slice(0, MAX_CONTEXT_CHARS) + '\n\n[...contexto truncado por límite de tamaño...]';
    }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/application/vault-query-service.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Suite completa + typecheck**

Run: `npm test && npm run typecheck`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add src/application/vault-query/vault-query-service.ts tests/application/vault-query-service.test.ts
git commit -m "feat(vault-query): capar el tamano del contexto del RAG (control de costo)"
```

---

## Task 9: Observabilidad — loguear el uso de tokens de cada llamada a Groq

**Contexto:** Ninguna llamada a Groq registra `usage` (prompt/completion/total tokens). No hace falta un sistema de billing completo para esta fase — alcanza con que quede en los logs de forma estructurada, para poder correlacionar picos de costo con endpoints/features en Railway más adelante.

**Files:**
- Modify: `src/infrastructure/ai/groq-client.ts`
- Test: `tests/ai/groq-usage-logging.test.ts` (nuevo)

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/ai/groq-usage-logging.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { groqFetchMock } = vi.hoisted(() => ({ groqFetchMock: vi.fn() }));

vi.mock('@/infrastructure/ai/groq-rate-limiter.js', () => ({ groqFetch: groqFetchMock }));
vi.mock('@/infrastructure/config/env.js', () => ({
  getEnv: () => ({ GROQ_API_KEY: 'test-key-abcdefghij' }),
}));

import { GroqClient } from '@/infrastructure/ai/groq-client.js';

beforeEach(() => {
  groqFetchMock.mockReset();
});

describe('GroqClient — logging de uso de tokens', () => {
  it('completeJSON loguea prompt/completion/total tokens cuando la API los devuelve', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    groqFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280 },
      }),
      text: async () => '',
    });

    const client = new GroqClient();
    await client.completeJSON('system', 'user');

    expect(infoSpy).toHaveBeenCalledWith(
      '[groq] usage',
      expect.objectContaining({ promptTokens: 1200, completionTokens: 80, totalTokens: 1280 }),
    );
    infoSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/ai/groq-usage-logging.test.ts`
Expected: FAIL — `console.info` nunca se llama con `'[groq] usage'` porque `completeJSON` hoy no loguea nada de `usage`.

- [ ] **Step 3: Agregar el logging**

En `src/infrastructure/ai/groq-client.ts`, extender la interfaz `GroqResponse` (líneas 8-10):

```ts
export interface GroqResponse {
  choices: { message: { content: string } }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
```

Y en el método `completeJSON` (líneas 65-90), después de obtener `data` y antes de parsear `raw`:

```ts
  async completeJSON<T>(systemPrompt: string, userPrompt: string): Promise<T | null> {
    if (!this.isConfigured) return null;
    try {
      const res = await groqFetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: TEXT_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 500,
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) { console.error('[groq] completeJSON error:', await res.text()); return null; }
      const data = await res.json() as GroqResponse;
      if (data.usage) {
        console.info('[groq] usage', {
          model: TEXT_MODEL,
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        });
      }
      const raw = data.choices[0]?.message.content ?? '';
      return JSON.parse(raw) as T;
    } catch (err) {
      console.error('[groq] completeJSON unexpected error:', err);
      return null;
    }
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/ai/groq-usage-logging.test.ts`
Expected: PASS (1/1)

- [ ] **Step 5: Suite completa + typecheck**

Run: `npm test && npm run typecheck`
Expected: todo en verde (el campo `usage` es opcional, así que ninguna respuesta mockeada existente sin `usage` se rompe).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/ai/groq-client.ts tests/ai/groq-usage-logging.test.ts
git commit -m "feat(observability): loguear uso de tokens en cada llamada a Groq"
```

---

## Task 10: `NightlyLearningService` — inyección de dependencias + suite de tests (hoy en cero)

**Contexto:** Es la otra pieza del RAG sin ningún test automatizado. Decide, con un LLM, qué señales del día ameritan una propuesta de edición a la bóveda — incluida la lógica de deduplicación (`merge` vs `create`) y el flag `requiresVerification` (que determina si un humano debe revisar el texto antes de aprobarlo). Es lógica de decisión real, no solo I/O.

**Files:**
- Modify: `src/application/nightly-learning/nightly-learning-service.ts`
- Test: `tests/application/nightly-learning-service.test.ts` (nuevo)

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/application/nightly-learning-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  dailySignal: { findMany: vi.fn(), updateMany: vi.fn() },
  vaultEditProposal: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
};
vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from('abc123')),
}));

vi.mock('@/application/vault-indexer/vault-indexer-service.js', () => ({
  VaultIndexerService: vi.fn().mockImplementation(() => ({
    indexVault: vi.fn().mockResolvedValue({ chunksUpserted: 0 }),
  })),
}));

const mockAi = { isConfigured: true, completeJSON: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockAi.isConfigured = true;
  mockDb.vaultEditProposal.findMany.mockResolvedValue([]);
});

describe('NightlyLearningService.runNightlyPipeline', () => {
  it('sin señales pendientes, no llama al LLM ni crea propuestas', async () => {
    const { NightlyLearningService } = await import('@/application/nightly-learning/nightly-learning-service.js');
    mockDb.dailySignal.findMany.mockResolvedValue([]);

    const svc = new NightlyLearningService(mockAi as never);
    await svc.runNightlyPipeline();

    expect(mockAi.completeJSON).not.toHaveBeenCalled();
    expect(mockDb.vaultEditProposal.create).not.toHaveBeenCalled();
  });

  it('crea una propuesta nueva para una señal procesada y la marca PROCESSED', async () => {
    const { NightlyLearningService } = await import('@/application/nightly-learning/nightly-learning-service.js');
    mockDb.dailySignal.findMany.mockResolvedValue([
      { id: 'sig-1', source: 'COSTISTA_CHAT', type: 'RAG_MISS', content: '¿Qué es el ITCS?' },
    ]);
    mockAi.completeJSON.mockResolvedValue({
      proposals: [{
        action: 'create',
        mergeIntoProposalId: null,
        title: 'Agregar definición de ITCS',
        sourceFile: 'Costeo/ITCS.md',
        proposedText: 'El ITCS es...',
        justification: 'Pregunta frecuente sin respuesta en la bóveda',
        groundedInSignals: false,
        signalsUsedIds: ['sig-1'],
      }],
    });

    const svc = new NightlyLearningService(mockAi as never);
    await svc.runNightlyPipeline();

    expect(mockDb.vaultEditProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Agregar definición de ITCS',
          status: 'PENDING',
          requiresVerification: true, // groundedInSignals: false → requiere verificación humana
        }),
      }),
    );
    expect(mockDb.dailySignal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['sig-1'] } },
      data: { status: 'PROCESSED' },
    });
  });

  it('señales que el LLM no usó en ninguna propuesta se marcan REJECTED', async () => {
    const { NightlyLearningService } = await import('@/application/nightly-learning/nightly-learning-service.js');
    mockDb.dailySignal.findMany.mockResolvedValue([
      { id: 'sig-1', source: 'COSTISTA_CHAT', type: 'RAG_MISS', content: 'pregunta irrelevante' },
    ]);
    mockAi.completeJSON.mockResolvedValue({ proposals: [] });

    const svc = new NightlyLearningService(mockAi as never);
    await svc.runNightlyPipeline();

    expect(mockDb.vaultEditProposal.create).not.toHaveBeenCalled();
    expect(mockDb.dailySignal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['sig-1'] } },
      data: { status: 'REJECTED' },
    });
  });

  it('un "merge" contra una propuesta pendiente real suma signalsUsed sin crear una fila nueva', async () => {
    const { NightlyLearningService } = await import('@/application/nightly-learning/nightly-learning-service.js');
    mockDb.dailySignal.findMany.mockResolvedValue([
      { id: 'sig-2', source: 'COSTISTA_CHAT', type: 'RAG_MISS', content: 'otra pregunta sobre ITCS' },
    ]);
    mockDb.vaultEditProposal.findMany.mockResolvedValue([
      { id: 'prop-1', title: 'Agregar ITCS', sourceFile: 'Costeo/ITCS.md', proposedText: 'texto previo' },
    ]);
    mockDb.vaultEditProposal.findUnique.mockResolvedValue({
      id: 'prop-1',
      signalsUsed: ['sig-1'],
    });
    mockAi.completeJSON.mockResolvedValue({
      proposals: [{
        action: 'merge',
        mergeIntoProposalId: 'prop-1',
        title: '', sourceFile: '', proposedText: '', justification: '',
        groundedInSignals: false,
        signalsUsedIds: ['sig-2'],
      }],
    });

    const svc = new NightlyLearningService(mockAi as never);
    await svc.runNightlyPipeline();

    expect(mockDb.vaultEditProposal.create).not.toHaveBeenCalled();
    expect(mockDb.vaultEditProposal.update).toHaveBeenCalledWith({
      where: { id: 'prop-1' },
      data: { signalsUsed: ['sig-1', 'sig-2'] },
    });
  });

  it('si el ai no está configurado, no procesa nada (skip silencioso documentado)', async () => {
    const { NightlyLearningService } = await import('@/application/nightly-learning/nightly-learning-service.js');
    mockAi.isConfigured = false;

    const svc = new NightlyLearningService(mockAi as never);
    await svc.runNightlyPipeline();

    expect(mockDb.dailySignal.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/application/nightly-learning-service.test.ts`
Expected: FAIL — `NightlyLearningService` todavía no acepta `ai` por constructor, así que `mockAi.completeJSON`/`mockAi.isConfigured` nunca se usan (el servicio sigue instanciando su propio `GroqService()` real).

- [ ] **Step 3: Hacer `NightlyLearningService` inyectable**

En `src/application/nightly-learning/nightly-learning-service.ts`, cambiar (líneas 31-36):

```ts
export class NightlyLearningService {
  private ai: GroqService;

  constructor() {
    this.ai = new GroqService();
  }
```

a:

```ts
export class NightlyLearningService {
  constructor(private readonly ai: GroqService = new GroqService()) {}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/application/nightly-learning-service.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Suite completa + typecheck**

Run: `npm test && npm run typecheck`
Expected: todo en verde — `new NightlyLearningService()` sin argumentos (como lo llama el worker de BullMQ) sigue funcionando igual gracias al default.

- [ ] **Step 6: Commit**

```bash
git add src/application/nightly-learning/nightly-learning-service.ts tests/application/nightly-learning-service.test.ts
git commit -m "test(nightly-learning): hacer el servicio inyectable y cubrir la logica de propuestas"
```

---

## Verificación final de la Fase 1

- [ ] `npm test` (backend) — toda la suite en verde, incluidos los ~23 tests nuevos de este plan (Tasks 1, 2, 7, 8, 9, 10).
- [ ] `npm run typecheck` (backend y frontend) — limpio.
- [ ] `npm run build` (backend, frontend, admin) — limpio.
- [ ] Recorrido manual en Chrome (con Docker + Postgres + Redis + keys reales de Groq/Voyage levantados):
  1. Chat del costista responde una pregunta de metodología (ej. "¿qué es la capacidad ociosa?") citando la bóveda.
  2. Chat del costista sigue respondiendo bien una pregunta de uso de la app (sin regresión).
  3. `MacroRiskPanel` filtra correctamente por indicador (Network tab: `?indicator=...`).
  4. Panel admin (`/admin`) ya no muestra la tarjeta de MRR.
  5. Logs del backend muestran `[groq] usage {...}` en cada llamada a Groq.

---

## Fases futuras (fuera de este documento — necesitan una decisión previa del equipo)

Estas quedaron identificadas en la auditoría pero **no se planifican en detalle todavía** porque cada una depende de una decisión que no es puramente técnica:

- **Contraste macro en la comparación de períodos** (la reconstrucción, con datos reales, de lo que era el panel "Variación de Costos País"): la base de cálculo (`period-comparison.ts`, ya testeada) y los datos macro (`MacroSnapshot`) existen, pero falta definir si el panel compara UNA estructura (extender `PeriodComparison.tsx`, cambio chico) o la CARTERA completa del costista (requiere una agregación nueva entre estructuras, cambio más grande) — es una decisión de producto, no de arquitectura.
- **Canal de ingesta por WhatsApp**: el modelo de datos ya lo anticipa (`sourceType: 'WHATSAPP'`, endpoint `submit-via-key`), pero falta elegir proveedor (Twilio vs. Meta Cloud API directo) y quién gestiona esa cuenta — tiene costo recurrente y requiere alta en una plataforma externa.
- **Separación de ambientes staging/producción real** y **rol de DB dedicado sin `BYPASSRLS`**: implica decisiones de infraestructura (¿segundo servicio en Railway? ¿qué presupuesto?) que no corresponde tomar unilateralmente.

Cuando el equipo defina estos tres puntos, se escribe un plan de Fase 2 con el mismo nivel de detalle que este documento.
