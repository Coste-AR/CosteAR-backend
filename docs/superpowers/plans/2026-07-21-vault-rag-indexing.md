# Indexación de la bóveda de costeo (RAG) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Indexar la bóveda de conocimiento de costeo (`costear-knowledge-base`, notas Markdown) en pgvector, generando embeddings con Voyage AI, de forma incremental e idempotente, para que un futuro sistema de RAG pueda buscar contexto confiable en ella.

**Architecture:** Un CLI (`npm run vault:index -- <path>`) recorre los `.md` de un vault clonado localmente, los trocea respetando su estructura (por headers), genera embeddings solo para los chunks nuevos o modificados (comparando hash de contenido) vía Voyage AI, y los guarda en una tabla Postgres con pgvector. Servicios TypeScript testeables con inyección de dependencias (sin librerías de mocking, siguiendo el patrón ya usado en `CostitaChatService`/`AdvisorService`).

**Tech Stack:** TypeScript, Prisma (raw SQL para la columna `vector`), pgvector sobre Postgres 16, Voyage AI (`voyage-4-large`, 1024 dims), Vitest.

**Diseño de referencia:** `docs/plans/2026-07-21-vault-rag-indexing-design.md` (ya commiteado).

---

## Antes de empezar

Este plan asume que estás parado en el worktree `feat-vault-rag-indexing` del repo `CosteAR-backend`, con `npm install` y `npm run prisma:generate` ya corridos (el workspace fue verificado con 158 tests pasando).

---

### Task 1: Habilitar pgvector en el Postgres local (docker-compose)

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Cambiar la imagen de Postgres**

En `docker-compose.yml`, el servicio `postgres` usa `postgres:16-alpine`, que NO trae la extensión `vector`. Reemplazá esa línea:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: costear-postgres
```

(El resto del servicio —`environment`, `ports`, `volumes`, `healthcheck`— queda igual. `pgvector/pgvector:pg16` es Postgres 16 estándar + la extensión precompilada, mismo formato de datos, así que el volumen existente sigue sirviendo.)

- [ ] **Step 2: Recrear el contenedor con la imagen nueva**

```bash
docker compose up -d --force-recreate postgres
```

Expected: el contenedor levanta sin errores. Verificá con:

```bash
docker exec -it costear-postgres psql -U costear -d costear -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname FROM pg_extension WHERE extname = 'vector';"
```
Expected output: una fila con `vector`.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: usar imagen pgvector/pgvector:pg16 para habilitar pgvector en local"
```

**Nota para producción (Railway):** antes de deployar, hay que confirmar que el plugin de Postgres de Railway permite `CREATE EXTENSION vector` (la mayoría de los Postgres gestionados modernos lo soportan, pero no es parte de este plan verificarlo — es una acción manual en el dashboard de Railway).

---

### Task 2: Agregar el modelo `VaultChunk` a Prisma y migrar

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_vault_chunks/migration.sql` (generado por Prisma, editado a mano)

- [ ] **Step 1: Agregar el modelo al schema**

Al final de `prisma/schema.prisma`, agregá:

```prisma
// ---------------------------------------------------------------------------
// Bóveda de conocimiento (RAG)
// ---------------------------------------------------------------------------

model VaultChunk {
  id          String   @id @default(uuid()) @db.Uuid
  sourceFile  String // path relativo dentro del vault, ej: "Costeo/Metodo-FIFO.md"
  sourceTitle String // título de la nota (H1 o nombre de archivo)
  headingPath String? // ej: "Costeo por Procesos > Método FIFO"
  content     String
  contentHash String // sha256 de headingPath+content — evita re-embedear sin cambios
  chunkIndex  Int
  vaultCommit String // sha del commit del vault de origen (trazabilidad)
  // Embedding de voyage-4-large (1024 dims). Prisma no tiene tipo nativo para
  // `vector`: se lee/escribe con SQL crudo (ver vault-chunk-repository.ts).
  // No lleva RLS: es conocimiento compartido, no dato de un tenant (mismo
  // criterio que MacroSnapshot).
  embedding Unsupported("vector(1024)")?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([sourceFile, chunkIndex])
  @@map("vault_chunks")
}
```

- [ ] **Step 2: Generar la migración sin aplicarla**

```bash
npx prisma migrate dev --name add_vault_chunks --create-only
```

Expected: crea `prisma/migrations/<timestamp>_add_vault_chunks/migration.sql` con un `CREATE TABLE "vault_chunks" (...)` que incluye la columna `"embedding" vector(1024)`.

- [ ] **Step 3: Editar la migración generada**

Abrí el archivo `migration.sql` recién creado y:
1. Agregá esta línea **al principio del archivo**:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
2. Agregá esto **al final del archivo**:
   ```sql
   CREATE INDEX "vault_chunks_embedding_idx" ON "vault_chunks" USING hnsw ("embedding" vector_cosine_ops);
   ```

- [ ] **Step 4: Aplicar la migración**

```bash
npx prisma migrate dev
```

Expected: `Your database is now in sync with your schema.` y el cliente de Prisma se regenera.

- [ ] **Step 5: Verificar**

```bash
docker exec -it costear-postgres psql -U costear -d costear -c "\d vault_chunks"
```
Expected: se ve la columna `embedding` con tipo `vector(1024)` y el índice `vault_chunks_embedding_idx`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): agregar tabla vault_chunks con pgvector para RAG"
```

---

### Task 3: Configuración — `VOYAGE_API_KEY`

**Files:**
- Modify: `src/infrastructure/config/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Agregar la variable al schema de env**

En `src/infrastructure/config/env.ts`, justo debajo de la línea `GROQ_API_KEY: z.string().min(1).default('groq_placeholder'),`, agregá:

```ts
  // IA — Voyage AI (embeddings para indexar la bóveda de costeo)
  VOYAGE_API_KEY: z.string().min(1).default('voyage_placeholder'),
```

- [ ] **Step 2: Documentar en `.env.example`**

En `.env.example`, debajo del bloque de `GROQ_API_KEY`, agregá:

```
# IA — Voyage AI (embeddings para indexar la bóveda de costeo, comando `npm run vault:index`)
# SIN una key válida, el indexador falla explícitamente al arrancar: sin
# embeddings no hay forma de indexar. Conseguir key en https://www.voyageai.com/
VOYAGE_API_KEY=pa-xxxxxxxxxxxxxxxxxxxx
```

- [ ] **Step 3: Verificar que el resto de tests de env sigan pasando**

```bash
npx vitest run tests/config/env.test.ts
```
Expected: PASS (la nueva variable tiene default, no rompe el fixture `valid` existente).

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/config/env.ts .env.example
git commit -m "feat(config): agregar VOYAGE_API_KEY"
```

---

### Task 4: `markdown-chunker` — troceo estructurado (TDD)

**Files:**
- Create: `src/application/vault-indexer/markdown-chunker.ts`
- Test: `tests/vault-indexer/markdown-chunker.test.ts`

- [ ] **Step 1: Escribir los tests (van a fallar — el módulo no existe todavía)**

Crear `tests/vault-indexer/markdown-chunker.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from '@/application/vault-indexer/markdown-chunker.js';

describe('chunkMarkdown', () => {
  it('genera un chunk por sección de nivel 2, con headingPath', () => {
    const raw = '# Costeo por Procesos\n\nIntro general.\n\n## Método FIFO\n\nTexto FIFO.\n\n## Método PEPS\n\nTexto PEPS.\n';
    const chunks = chunkMarkdown('Costeo/procesos.md', raw);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ sourceTitle: 'Costeo por Procesos', headingPath: null, content: 'Intro general.', chunkIndex: 0 });
    expect(chunks[1]).toMatchObject({ sourceTitle: 'Costeo por Procesos', headingPath: 'Método FIFO', content: 'Texto FIFO.', chunkIndex: 1 });
    expect(chunks[2]).toMatchObject({ sourceTitle: 'Costeo por Procesos', headingPath: 'Método PEPS', content: 'Texto PEPS.', chunkIndex: 2 });
  });

  it('anida headings de nivel 3 bajo el nivel 2 actual', () => {
    const raw = '# Nota\n\n## Método FIFO\n\n### Ejemplo\n\nUn ejemplo concreto.\n';
    const chunks = chunkMarkdown('nota.md', raw);

    const ejemplo = chunks.find((c) => c.content === 'Un ejemplo concreto.');
    expect(ejemplo?.headingPath).toBe('Método FIFO > Ejemplo');
  });

  it('usa el nombre de archivo como título si no hay H1', () => {
    const raw = 'Contenido sin título.\n';
    const chunks = chunkMarkdown('sin-titulo.md', raw);
    expect(chunks[0]?.sourceTitle).toBe('sin-titulo');
  });

  it('devuelve un array vacío para una nota sin contenido', () => {
    expect(chunkMarkdown('vacia.md', '')).toEqual([]);
    expect(chunkMarkdown('vacia.md', '   \n\n  ')).toEqual([]);
  });

  it('produce el mismo contentHash si el contenido no cambia, y distinto si cambia', () => {
    const a = chunkMarkdown('x.md', '# X\n\n## Sección\n\nTexto original.\n');
    const b = chunkMarkdown('x.md', '# X\n\n## Sección\n\nTexto original.\n');
    const c = chunkMarkdown('x.md', '# X\n\n## Sección\n\nTexto modificado.\n');

    expect(a[1]?.contentHash).toBe(b[1]?.contentHash);
    expect(a[1]?.contentHash).not.toBe(c[1]?.contentHash);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
npx vitest run tests/vault-indexer/markdown-chunker.test.ts
```
Expected: FAIL — `Cannot find module '@/application/vault-indexer/markdown-chunker.js'`.

- [ ] **Step 3: Implementar `markdown-chunker.ts`**

Crear `src/application/vault-indexer/markdown-chunker.ts`:

```ts
import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

export interface MarkdownChunk {
  sourceTitle: string;
  headingPath: string | null;
  content: string;
  chunkIndex: number;
  contentHash: string;
}

const H1_RE = /^#\s+.+$/;
const HEADING_RE = /^(#{2,3})\s+(.+)$/;

/**
 * Trocea una nota Markdown respetando su estructura: un chunk por sección
 * de nivel 2/3, más un chunk inicial para el texto que cuelga directo del H1
 * (si lo hay). El título de la nota (H1, o el nombre de archivo si no hay H1)
 * se propaga a todos los chunks para dar contexto.
 */
export function chunkMarkdown(filePath: string, rawContent: string): MarkdownChunk[] {
  const lines = rawContent.split(/\r?\n/);

  const h1Match = lines.find((l) => H1_RE.test(l));
  const sourceTitle = h1Match
    ? h1Match.replace(/^#\s+/, '').trim()
    : basename(filePath, extname(filePath));

  type Section = { headingPath: string | null; lines: string[] };
  const sections: Section[] = [{ headingPath: null, lines: [] }];
  const stack: string[] = [];

  for (const line of lines) {
    if (H1_RE.test(line)) continue; // ya usado como sourceTitle

    const match = HEADING_RE.exec(line);
    if (!match) {
      sections[sections.length - 1]!.lines.push(line);
      continue;
    }

    const level = match[1]!.length; // 2 o 3
    const text = match[2]!.trim();
    if (level === 2) {
      stack[0] = text;
      stack.length = 1;
    } else {
      stack[1] = text;
      stack.length = 2;
    }
    sections.push({ headingPath: stack.join(' > '), lines: [] });
  }

  const chunks: MarkdownChunk[] = [];
  let chunkIndex = 0;
  for (const section of sections) {
    const content = section.lines.join('\n').trim();
    if (!content) continue;
    const contentHash = createHash('sha256')
      .update(`${section.headingPath ?? ''}\n${content}`)
      .digest('hex');
    chunks.push({ sourceTitle, headingPath: section.headingPath, content, chunkIndex, contentHash });
    chunkIndex++;
  }
  return chunks;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
npx vitest run tests/vault-indexer/markdown-chunker.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/vault-indexer/markdown-chunker.ts tests/vault-indexer/markdown-chunker.test.ts
git commit -m "feat(vault-indexer): chunking estructurado de notas Markdown"
```

---

### Task 5: `VoyageService` — cliente de embeddings

**Files:**
- Create: `src/infrastructure/ai/voyage-service.ts`

No lleva test de red dedicado — mismo criterio que `GroqService`, que tampoco lo tiene (se testea el comportamiento alrededor vía inyección de dependencias, ver Task 7).

- [ ] **Step 1: Implementar el servicio**

Crear `src/infrastructure/ai/voyage-service.ts`:

```ts
/**
 * Cliente de embeddings de Voyage AI, usado para indexar la bóveda de
 * costeo. Voyage no ofrece chat (eso lo sigue resolviendo Groq) — esto es
 * exclusivamente para convertir texto a vectores.
 */
import { getEnv } from '../config/env.js';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const EMBEDDING_MODEL = 'voyage-4-large';
export const EMBEDDING_DIMENSIONS = 1024;

interface VoyageEmbeddingsResponse {
  data: { embedding: number[]; index: number }[];
}

/** Interfaz mínima para poder inyectar un fake en tests. */
export interface Embedder {
  readonly isConfigured: boolean;
  embed(texts: string[], inputType?: 'document' | 'query'): Promise<number[][] | null>;
}

export class VoyageService implements Embedder {
  private readonly apiKey: string;

  constructor() {
    this.apiKey = getEnv().VOYAGE_API_KEY;
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 10 && this.apiKey !== 'voyage_placeholder';
  }

  /**
   * Devuelve un embedding por texto, en el mismo orden que `texts`.
   * Devuelve null solo ante error de transporte/config — nunca lanza.
   */
  async embed(texts: string[], inputType: 'document' | 'query' = 'document'): Promise<number[][] | null> {
    if (!this.isConfigured) return null;
    if (texts.length === 0) return [];

    try {
      const res = await fetch(VOYAGE_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: texts,
          model: EMBEDDING_MODEL,
          input_type: inputType,
          output_dimension: EMBEDDING_DIMENSIONS,
        }),
      });
      if (!res.ok) {
        console.error('[voyage] Error de API:', await res.text());
        return null;
      }
      const data = (await res.json()) as VoyageEmbeddingsResponse;
      return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    } catch (err) {
      console.error('[voyage] Error inesperado:', err);
      return null;
    }
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/ai/voyage-service.ts
git commit -m "feat(ai): cliente de embeddings Voyage AI (voyage-4-large)"
```

---

### Task 6: `VaultChunkRepository` — persistencia (Prisma + SQL crudo para el vector)

**Files:**
- Create: `src/application/vault-indexer/vault-chunk-repository.ts`

Sin test unitario dedicado: esta clase es una capa fina sobre Prisma/SQL crudo que necesita una DB real con pgvector para probarse con sentido — se verifica con el smoke test manual de la Task 9. La lógica de negocio (qué se sube, qué se saltea, qué se borra) vive en `VaultIndexerService` (Task 7), que sí se testea con un fake de esta interfaz.

- [ ] **Step 1: Implementar la interfaz y la implementación Prisma**

Crear `src/application/vault-indexer/vault-chunk-repository.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';

export interface VaultChunkIdentity {
  chunkIndex: number;
  contentHash: string;
}

export interface UpsertChunkInput {
  sourceFile: string;
  sourceTitle: string;
  headingPath: string | null;
  content: string;
  contentHash: string;
  chunkIndex: number;
  vaultCommit: string;
  embedding: number[];
}

export interface VaultChunkRepository {
  listBySourceFile(sourceFile: string): Promise<VaultChunkIdentity[]>;
  upsertChunk(input: UpsertChunkInput): Promise<void>;
  /** Borra los chunks de `sourceFile` cuyo chunkIndex sea mayor a `keepUpTo`
   *  (la nota se achicó). Pasar -1 borra todos los chunks de ese archivo.
   *  Devuelve cuántos borró. */
  deleteChunksBeyondIndex(sourceFile: string, keepUpTo: number): Promise<number>;
  /** Borra todo chunk cuyo sourceFile NO esté en `currentSourceFiles`
   *  (notas eliminadas/renombradas). Devuelve cuántos borró. */
  deleteOrphanChunks(currentSourceFiles: string[]): Promise<number>;
}

export class PrismaVaultChunkRepository implements VaultChunkRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async listBySourceFile(sourceFile: string): Promise<VaultChunkIdentity[]> {
    return this.db.vaultChunk.findMany({
      where: { sourceFile },
      select: { chunkIndex: true, contentHash: true },
    });
  }

  async upsertChunk(input: UpsertChunkInput): Promise<void> {
    const vectorLiteral = `[${input.embedding.join(',')}]`;
    await this.db.$executeRaw`
      INSERT INTO "vault_chunks"
        ("id", "sourceFile", "sourceTitle", "headingPath", "content", "contentHash", "chunkIndex", "vaultCommit", "embedding", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), ${input.sourceFile}, ${input.sourceTitle}, ${input.headingPath}, ${input.content}, ${input.contentHash}, ${input.chunkIndex}, ${input.vaultCommit}, ${vectorLiteral}::vector, now(), now())
      ON CONFLICT ("sourceFile", "chunkIndex")
      DO UPDATE SET
        "sourceTitle" = EXCLUDED."sourceTitle",
        "headingPath" = EXCLUDED."headingPath",
        "content" = EXCLUDED."content",
        "contentHash" = EXCLUDED."contentHash",
        "vaultCommit" = EXCLUDED."vaultCommit",
        "embedding" = EXCLUDED."embedding",
        "updatedAt" = now()
    `;
  }

  async deleteChunksBeyondIndex(sourceFile: string, keepUpTo: number): Promise<number> {
    const result = await this.db.vaultChunk.deleteMany({
      where: { sourceFile, chunkIndex: { gt: keepUpTo } },
    });
    return result.count;
  }

  async deleteOrphanChunks(currentSourceFiles: string[]): Promise<number> {
    if (currentSourceFiles.length === 0) {
      const result = await this.db.vaultChunk.deleteMany({});
      return result.count;
    }
    const result = await this.db.vaultChunk.deleteMany({
      where: { sourceFile: { notIn: currentSourceFiles } },
    });
    return result.count;
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: sin errores nuevos. (Si Prisma se queja de que `vaultChunk` no existe en el cliente, correr `npm run prisma:generate` — la Task 2 ya debería haberlo dejado listo.)

- [ ] **Step 3: Commit**

```bash
git add src/application/vault-indexer/vault-chunk-repository.ts
git commit -m "feat(vault-indexer): repositorio de chunks (Prisma + SQL crudo para pgvector)"
```

---

### Task 7: `VaultIndexerService` — orquestación (TDD)

**Files:**
- Create: `src/application/vault-indexer/vault-indexer-service.ts`
- Test: `tests/vault-indexer/vault-indexer-service.test.ts`

- [ ] **Step 1: Escribir los tests (van a fallar — el módulo no existe todavía)**

Crear `tests/vault-indexer/vault-indexer-service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultIndexerService } from '@/application/vault-indexer/vault-indexer-service.js';
import type {
  VaultChunkRepository,
  UpsertChunkInput,
  VaultChunkIdentity,
} from '@/application/vault-indexer/vault-chunk-repository.js';
import type { Embedder } from '@/infrastructure/ai/voyage-service.js';

class FakeRepository implements VaultChunkRepository {
  chunks = new Map<string, UpsertChunkInput>();

  async listBySourceFile(sourceFile: string): Promise<VaultChunkIdentity[]> {
    return [...this.chunks.values()]
      .filter((c) => c.sourceFile === sourceFile)
      .map((c) => ({ chunkIndex: c.chunkIndex, contentHash: c.contentHash }));
  }

  async upsertChunk(input: UpsertChunkInput): Promise<void> {
    this.chunks.set(`${input.sourceFile}#${input.chunkIndex}`, input);
  }

  async deleteChunksBeyondIndex(sourceFile: string, keepUpTo: number): Promise<number> {
    let count = 0;
    for (const [key, chunk] of this.chunks) {
      if (chunk.sourceFile === sourceFile && chunk.chunkIndex > keepUpTo) {
        this.chunks.delete(key);
        count++;
      }
    }
    return count;
  }

  async deleteOrphanChunks(currentSourceFiles: string[]): Promise<number> {
    let count = 0;
    for (const [key, chunk] of this.chunks) {
      if (!currentSourceFiles.includes(chunk.sourceFile)) {
        this.chunks.delete(key);
        count++;
      }
    }
    return count;
  }
}

class FakeEmbedder implements Embedder {
  isConfigured = true;
  calls: string[][] = [];

  async embed(texts: string[]): Promise<number[][] | null> {
    this.calls.push(texts);
    return texts.map((_, i) => [i, i + 1, i + 2]);
  }
}

describe('VaultIndexerService', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'vault-test-'));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it('indexa una nota nueva, generando un chunk por sección', async () => {
    await writeFile(
      join(vaultPath, 'fifo.md'),
      '# Método FIFO\n\nIntro.\n\n## Cálculo\n\nEl costo se calcula así.\n',
      'utf-8',
    );
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const service = new VaultIndexerService(repo, embedder);

    const result = await service.indexVault(vaultPath, 'commit-1');

    expect(result.filesProcessed).toBe(1);
    expect(result.chunksUpserted).toBe(2);
    expect(result.chunksSkippedUnchanged).toBe(0);
    expect(repo.chunks.size).toBe(2);
  });

  it('omite re-embedear chunks cuyo contenido no cambió', async () => {
    await writeFile(join(vaultPath, 'nota.md'), '# Nota\n\nContenido sin cambios.\n', 'utf-8');
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const service = new VaultIndexerService(repo, embedder);

    await service.indexVault(vaultPath, 'commit-1');
    embedder.calls = [];
    const second = await service.indexVault(vaultPath, 'commit-2');

    expect(second.chunksUpserted).toBe(0);
    expect(second.chunksSkippedUnchanged).toBe(1);
    expect(embedder.calls).toEqual([]);
  });

  it('borra los chunks huérfanos de notas eliminadas', async () => {
    // Se mantiene una segunda nota en el vault a propósito: borrar la ÚLTIMA
    // nota dejaría el vault en cero archivos .md, que es exactamente el caso
    // que bloquea la salvaguarda de "vault vacío" de arriba (indistinguible
    // de un path mal configurado). Ese escenario ya lo cubre el test
    // "lanza error si el vault no tiene notas .md" — acá probamos borrado de
    // huérfanos cuando el vault sigue teniendo contenido válido.
    await writeFile(join(vaultPath, 'permanente.md'), '# Permanente\n\nEsta nota se queda.\n', 'utf-8');
    const filePath = join(vaultPath, 'temporal.md');
    await writeFile(filePath, '# Temporal\n\nEsto se va a borrar.\n', 'utf-8');
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const service = new VaultIndexerService(repo, embedder);

    await service.indexVault(vaultPath, 'commit-1');
    expect(repo.chunks.size).toBe(2); // 1 chunk de permanente.md + 1 de temporal.md

    await rm(filePath);
    const result = await service.indexVault(vaultPath, 'commit-2');

    expect(result.chunksDeleted).toBe(1);
    expect(repo.chunks.size).toBe(1); // solo queda el chunk de permanente.md
  });

  it('achica una nota con menos secciones y borra los chunks sobrantes', async () => {
    const filePath = join(vaultPath, 'nota.md');
    await writeFile(
      filePath,
      '# Nota\n\nIntro.\n\n## Uno\n\nTexto uno.\n\n## Dos\n\nTexto dos.\n',
      'utf-8',
    );
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const service = new VaultIndexerService(repo, embedder);

    await service.indexVault(vaultPath, 'commit-1');
    expect(repo.chunks.size).toBe(3);

    await writeFile(filePath, '# Nota\n\nSolo esto queda.\n', 'utf-8');
    const result = await service.indexVault(vaultPath, 'commit-2');

    expect(repo.chunks.size).toBe(1);
    expect(result.chunksDeleted).toBe(2);
  });

  it('lanza error si Voyage no está configurado', async () => {
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    embedder.isConfigured = false;
    const service = new VaultIndexerService(repo, embedder);

    await expect(service.indexVault(vaultPath, 'commit-1')).rejects.toThrow('VOYAGE_API_KEY');
  });

  it('lanza error si el vault no tiene notas .md, sin borrar nada existente', async () => {
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const service = new VaultIndexerService(repo, embedder);

    // vaultPath está vacío (mkdtemp recién creado, sin escribir ningún .md)
    await expect(service.indexVault(vaultPath, 'commit-1')).rejects.toThrow('No se encontraron notas');
    expect(repo.chunks.size).toBe(0); // no llamó a deleteOrphanChunks([]) de forma destructiva
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
npx vitest run tests/vault-indexer/vault-indexer-service.test.ts
```
Expected: FAIL — `Cannot find module '@/application/vault-indexer/vault-indexer-service.js'`.

- [ ] **Step 3: Implementar `vault-indexer-service.ts`**

Crear `src/application/vault-indexer/vault-indexer-service.ts`:

```ts
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { chunkMarkdown } from './markdown-chunker.js';
import { PrismaVaultChunkRepository, type VaultChunkRepository } from './vault-chunk-repository.js';
import { VoyageService, type Embedder } from '../../infrastructure/ai/voyage-service.js';

export interface IndexVaultResult {
  filesProcessed: number;
  chunksUpserted: number;
  chunksSkippedUnchanged: number;
  chunksDeleted: number;
  filesWithErrors: string[];
}

const IGNORED_DIRS = new Set(['.obsidian', '.trash', '.git']);

async function listMarkdownFiles(rootDir: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        result.push(join(dir, entry.name));
      }
    }
  }
  await walk(rootDir);
  return result;
}

export class VaultIndexerService {
  constructor(
    private readonly repo: VaultChunkRepository = new PrismaVaultChunkRepository(),
    private readonly embedder: Embedder = new VoyageService(),
  ) {}

  async indexVault(vaultPath: string, vaultCommit: string): Promise<IndexVaultResult> {
    if (!this.embedder.isConfigured) {
      throw new Error('VOYAGE_API_KEY no configurada: no se puede indexar sin embeddings.');
    }

    const absoluteFiles = await listMarkdownFiles(vaultPath);
    if (absoluteFiles.length === 0) {
      // Salvaguarda: deleteOrphanChunks([]) borraría TODA la tabla vault_chunks
      // (ver vault-chunk-repository.ts). Un vault vacío/mal configurado no debe
      // poder vaciar la bóveda indexada — tratamos "cero notas" como error de
      // configuración, no como "se borraron todas las notas".
      throw new Error(
        `No se encontraron notas .md en ${vaultPath}. Verificá el path — por seguridad no se borra nada de la bóveda indexada.`,
      );
    }
    const relativeFiles = absoluteFiles.map((f) => relative(vaultPath, f).replace(/\\/g, '/'));

    const result: IndexVaultResult = {
      filesProcessed: 0,
      chunksUpserted: 0,
      chunksSkippedUnchanged: 0,
      chunksDeleted: 0,
      filesWithErrors: [],
    };

    for (let i = 0; i < absoluteFiles.length; i++) {
      const absoluteFile = absoluteFiles[i]!;
      const sourceFile = relativeFiles[i]!;
      try {
        await this.indexFile(absoluteFile, sourceFile, vaultCommit, result);
        result.filesProcessed++;
      } catch (err) {
        console.error(`[vault-indexer] Error indexando ${sourceFile}:`, err);
        result.filesWithErrors.push(sourceFile);
      }
    }

    result.chunksDeleted += await this.repo.deleteOrphanChunks(relativeFiles);

    return result;
  }

  private async indexFile(
    absoluteFile: string,
    sourceFile: string,
    vaultCommit: string,
    result: IndexVaultResult,
  ): Promise<void> {
    const rawContent = await readFile(absoluteFile, 'utf-8');
    const chunks = chunkMarkdown(sourceFile, rawContent);
    const existing = await this.repo.listBySourceFile(sourceFile);
    const existingByIndex = new Map(existing.map((e) => [e.chunkIndex, e.contentHash]));

    const toEmbed = chunks.filter((c) => existingByIndex.get(c.chunkIndex) !== c.contentHash);
    result.chunksSkippedUnchanged += chunks.length - toEmbed.length;

    if (toEmbed.length > 0) {
      const embeddings = await this.embedder.embed(toEmbed.map((c) => c.content), 'document');
      if (!embeddings) {
        throw new Error(`Voyage no devolvió embeddings para ${sourceFile}`);
      }
      for (let i = 0; i < toEmbed.length; i++) {
        const chunk = toEmbed[i]!;
        await this.repo.upsertChunk({
          sourceFile,
          sourceTitle: chunk.sourceTitle,
          headingPath: chunk.headingPath,
          content: chunk.content,
          contentHash: chunk.contentHash,
          chunkIndex: chunk.chunkIndex,
          vaultCommit,
          embedding: embeddings[i]!,
        });
        result.chunksUpserted++;
      }
    }

    result.chunksDeleted += await this.repo.deleteChunksBeyondIndex(sourceFile, chunks.length - 1);
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
npx vitest run tests/vault-indexer/vault-indexer-service.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Correr toda la suite para verificar que no rompiste nada**

```bash
npm test
```
Expected: todos los tests pasan, 0 failures (el número total exacto no importa — lo que importa es 0 failures).

- [ ] **Step 6: Commit**

```bash
git add src/application/vault-indexer/vault-indexer-service.ts tests/vault-indexer/vault-indexer-service.test.ts
git commit -m "feat(vault-indexer): orquestación del indexado (incremental, idempotente)"
```

---

### Task 8: CLI y script de npm

**Files:**
- Create: `src/application/vault-indexer/cli.ts`
- Modify: `package.json`

- [ ] **Step 1: Implementar el entrypoint**

Crear `src/application/vault-indexer/cli.ts`:

```ts
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { VaultIndexerService } from './vault-indexer-service.js';

function getVaultCommit(vaultPath: string): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: vaultPath }).toString().trim();
  } catch {
    throw new Error(`${vaultPath} no es un repositorio Git válido. Verificá que sea un vault clonado correctamente.`);
  }
}

async function main(): Promise<void> {
  const vaultPath = process.argv[2];
  if (!vaultPath) {
    console.error('Uso: npm run vault:index -- <path-al-vault-clonado>');
    process.exit(1);
  }
  if (!existsSync(vaultPath)) {
    console.error(`Error: la ruta no existe: ${vaultPath}`);
    process.exit(1);
  }

  const vaultCommit = getVaultCommit(vaultPath);
  console.log(`Indexando bóveda en ${vaultPath} (commit ${vaultCommit.slice(0, 7)})...`);

  const service = new VaultIndexerService();
  const result = await service.indexVault(vaultPath, vaultCommit);

  console.log(`Archivos procesados: ${result.filesProcessed}`);
  console.log(`Chunks nuevos/actualizados: ${result.chunksUpserted}`);
  console.log(`Chunks sin cambios (omitidos): ${result.chunksSkippedUnchanged}`);
  console.log(`Chunks eliminados (huérfanos o de notas achicadas): ${result.chunksDeleted}`);
  if (result.filesWithErrors.length > 0) {
    console.error(`Archivos con errores: ${result.filesWithErrors.join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[vault:index] Error fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Agregar el script a `package.json`**

En la sección `"scripts"`, junto a `"worker"`, agregá:

```json
    "vault:index": "tsx --env-file=.env src/application/vault-indexer/cli.ts",
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/application/vault-indexer/cli.ts package.json
git commit -m "feat(vault-indexer): CLI \`npm run vault:index\`"
```

---

### Task 9: Smoke test manual end-to-end

La bóveda real todavía no está subida por el equipo — esto verifica que el pipeline completo funciona con datos de prueba, antes de que llegue contenido real.

**Files:** ninguno (solo verificación manual).

- [ ] **Step 1: Crear una bóveda de prueba mínima**

```bash
mkdir -p /tmp/vault-smoke-test
cd /tmp/vault-smoke-test
git init -q
mkdir -p Costeo
cat > Costeo/fifo.md << 'EOF'
# Método FIFO

El método FIFO (First In, First Out) asume que las primeras unidades
compradas son las primeras en salir del inventario.

## Cálculo del costo

El costo de las unidades vendidas se calcula usando el costo de las
existencias más antiguas primero.
EOF
git add . && git commit -q -m "vault de prueba"
cd -
```

- [ ] **Step 2: Configurar `VOYAGE_API_KEY` real**

En el `.env` del worktree, poné una API key real de Voyage (conseguirla en https://www.voyageai.com/ — tiene free tier).

- [ ] **Step 3: Correr el indexador**

```bash
npm run vault:index -- /tmp/vault-smoke-test
```
Expected:
```
Indexando bóveda en /tmp/vault-smoke-test (commit xxxxxxx)...
Archivos procesados: 1
Chunks nuevos/actualizados: 2
Chunks sin cambios (omitidos): 0
Chunks eliminados (huérfanos): 0
```

- [ ] **Step 4: Verificar en la DB**

```bash
docker exec -it costear-postgres psql -U costear -d costear -c "SELECT \"sourceFile\", \"headingPath\", left(content, 40) FROM vault_chunks;"
```
Expected: 2 filas, una con `headingPath` NULL (el intro) y otra con `headingPath = 'Cálculo del costo'`.

- [ ] **Step 5: Correr de nuevo sin cambios — debe ser un no-op**

```bash
npm run vault:index -- /tmp/vault-smoke-test
```
Expected: `Chunks nuevos/actualizados: 0`, `Chunks sin cambios (omitidos): 2` (no vuelve a llamar a Voyage).

- [ ] **Step 6: Limpiar**

```bash
rm -rf /tmp/vault-smoke-test
docker exec -it costear-postgres psql -U costear -d costear -c "DELETE FROM vault_chunks;"
```

---

## Fuera de alcance de este plan

Ya documentado en el diseño (`docs/plans/2026-07-21-vault-rag-indexing-design.md`): búsqueda a query-time (hybrid search + reranking), endpoint de preguntas y respuestas, pipeline nocturno de correcciones, sistema de roles.
