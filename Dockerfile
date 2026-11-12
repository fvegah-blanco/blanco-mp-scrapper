# Node 22: Prisma 7 y require(esm). Debian slim (no alpine): @napi-rs/canvas trae binarios glibc.
FROM node:22-slim AS base
# openssl: Prisma lo necesita para elegir su motor.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencias
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
# Los motores de Prisma se bajan aquí (npm ci va sin scripts): en ejecución el usuario no es root.
RUN node node_modules/@prisma/engines/dist/scripts/postinstall.js

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
# Sin root: el proceso solo escribe en storage/ y tmp/.
RUN mkdir -p storage tmp && chown -R node:node storage tmp
USER node
# Las migraciones corren al arrancar, como en el back office.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
EXPOSE 4500
