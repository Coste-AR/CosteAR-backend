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

# set -x traza cada comando en stderr para verlo en Deploy Logs.
# El ; antes del servidor garantiza que arranca aunque apply-rls falle.
CMD ["sh", "-c", "set -x && node scripts/migrate-deploy.mjs && node scripts/apply-rls.mjs ; node dist/infrastructure/http/entry.js"]
