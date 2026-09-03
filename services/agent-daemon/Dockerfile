# Strucureo agent daemon — Node 22 slim, pnpm, runs migrations then daemon.
FROM node:22-slim AS deps
# Pinned, non-interactive pnpm (corepack alone would prompt to download).
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-slim AS run
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig*.json ./
COPY src ./src
# tsx runs the TS sources directly — no build step to drift.
CMD ["sh", "-c", "node_modules/.bin/tsx src/db/migrate.ts && node_modules/.bin/tsx src/index.ts daemon"]
