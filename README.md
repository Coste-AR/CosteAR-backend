# CosteAR — Backend

API de automatización de costos para profesionales argentinos. Motor de cálculo
(MP + MOD + CIP + Estado de Costos), integración de datos macroeconómicos en
tiempo real (BCRA, INDEC) y alertas proactivas de márgenes.

## Stack

- **Node.js 22 + TypeScript** (strict)
- **Fastify v5** — HTTP, schema-first
- **Prisma 6 + PostgreSQL 16** — con Row-Level Security multi-tenant
- **Redis 7 + BullMQ** — jobs y rate limiting
- **decimal.js** — precisión financiera exacta (cero floats en montos)
- **Argon2id + JWT RS256** — autenticación
- **Vitest** — testing (72 tests)

## Arquitectura (Clean Architecture)

```
src/
├── domain/            # Lógica pura: value objects + motor de cálculo + errores
│   ├── value-objects/ # Money, Percentage (decimal.js)
│   └── calculations/  # MP, MOD, CIP, Estado de Costos (las 4 "hojas")
├── application/       # Casos de uso: auth, companies, cost-structures, macro, alerts
├── infrastructure/    # HTTP, DB, crypto, workers, APIs externas, email
└── shared/            # Schemas Zod compartidos
```

## Setup local

### 1. Requisitos
- Node.js ≥ 22
- Docker Desktop (para Postgres + Redis)

### 2. Instalar dependencias
```bash
npm install
```

### 3. Variables de entorno
```bash
cp .env.example .env
npm run keys:generate    # genera claves JWT + secretos; pegá la salida en .env
```

### 4. Levantar la infraestructura
```bash
docker compose up -d     # Postgres en :5433, Redis en :6380
```
> Si Docker Desktop está colgado, reiniciarlo. Verificá con `docker compose ps`
> (ambos servicios deben figurar `healthy`).

### 5. Base de datos (migración + RLS)
```bash
npm run db:setup         # corre la migración inicial y aplica las políticas RLS
```

### 6. Correr
```bash
npm run dev              # API en http://localhost:3000
npm run worker           # workers de sync macro + recálculo (en otra terminal)
```

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | API con hot-reload |
| `npm run worker` | Workers BullMQ (macro-sync, recalculate) |
| `npm test` | Suite de tests (Vitest) |
| `npm run typecheck` | Chequeo de tipos sin emitir |
| `npm run db:setup` | Migración + RLS (primera vez) |
| `npm run db:rls` | Re-aplica solo las políticas RLS |
| `npm run keys:generate` | Genera claves JWT y secretos para `.env` |

## Seguridad

- **Auth**: JWT RS256 (access 15 min) + refresh token opaco en cookie httpOnly,
  rotado en cada uso con invalidación de familia (anti robo de sesión).
- **Passwords**: Argon2id + pepper. **2FA** TOTP con secreto cifrado AES-256-GCM.
- **Multi-tenancy**: Row-Level Security en PostgreSQL (`prisma/rls.sql`).
- **Anti-bruteforce**: lockout tras 5 intentos fallidos.
- **Rate limiting**: Redis-backed, estricto en endpoints de auth.
- **Headers**: Helmet (HSTS, CSP, etc.). **CORS**: lista blanca explícita.
- **Auditoría**: trail append-only de toda acción sensible.
- **Validación**: Zod en el 100% de los inputs.

> **Producción:** crear un rol de DB dedicado SIN `BYPASSRLS` ni superusuario,
> o las políticas RLS se ignoran.

## Motor de cálculo

Porta `motor de cálculo v3.0.xlsx` (Cátedra de Costos, UNT) a TypeScript puro,
verificado contra los valores ejemplo del Excel:

| Hoja | Módulo | Verificación |
|---|---|---|
| 1 · MP | Wilson + ficha de stock PPP | LE = 836.66, MP consumida = $943.250 |
| 2 · MOD | Días trabajados + ITCS + tarifa horaria | — |
| 3 · CIP | Prorrateo primario/secundario + cuotas + variaciones | Regla de control de la cátedra |
| 4 · Estado | Consolidación → CPV + margen | — |

## API

Endpoints versionados bajo `/api/v1`. Healthcheck en `GET /health`.
Ver `src/infrastructure/http/routes/` para el detalle.
