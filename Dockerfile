# Node 22: Prisma 7 y require(esm). Debian slim (no alpine): @napi-rs/canvas trae binarios glibc.
FROM node:22-slim AS base
WORKDIR /app

FROM base AS dependencias
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

FROM base AS build
COPY --from=dependencias /app/node_modules ./node_modules
COPY . .
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate && npm run build

FROM base AS produccion
ENV NODE_ENV=production
COPY --from=dependencias /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts package.json ./
COPY public ./public
# Las migraciones corren al arrancar, como en el back office.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
EXPOSE 4500
