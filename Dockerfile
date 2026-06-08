# --- Build ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

# --- Runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
COPY scripts ./scripts

EXPOSE 3000
# Aplica migraciones + RLS y arranca la API.
CMD ["sh", "-c", "npx prisma migrate deploy && node scripts/apply-rls.mjs && node dist/infrastructure/http/server.js"]
