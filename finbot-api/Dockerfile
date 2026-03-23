# Stage 1: builder
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

# prisma generate must run before tsc — it creates the PrismaClient, Plan,
# and Prisma types that the app imports. Schema must be present first.
COPY prisma/ ./prisma/
RUN npx prisma generate

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

RUN npm prune --omit=dev

# Stage 2: runner
FROM node:22-alpine AS runner
WORKDIR /app

# tini: proper PID 1 signal handling (SIGTERM forwarding, zombie reaping)
RUN apk add --no-cache tini

RUN addgroup -S finbot && adduser -S finbot -G finbot

# --chown ensures the non-root user owns the files, not root
COPY --from=builder --chown=finbot:finbot /app/package.json ./
COPY --from=builder --chown=finbot:finbot /app/node_modules  ./node_modules
COPY --from=builder --chown=finbot:finbot /app/dist          ./dist
COPY --chown=finbot:finbot prisma/                           ./prisma/

USER finbot
EXPOSE 3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
