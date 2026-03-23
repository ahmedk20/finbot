# Stage 1: builder
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

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

COPY --from=builder --chown=finbot:finbot /app/package.json ./
COPY --from=builder --chown=finbot:finbot /app/node_modules  ./node_modules
COPY --from=builder --chown=finbot:finbot /app/dist          ./dist

USER finbot
ENV NODE_ENV=production

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
