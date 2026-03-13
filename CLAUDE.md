# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Services

This is a monorepo with two TypeScript/Node.js microservices and two placeholder services:

- **finbot-api/** — Main Express API (auth, billing, news, sentiment, trading signals, usage, webhooks)
- **news-scraper/** — Scheduled news scraping and preprocessing pipeline feeding into signals
- **dashboard/** — Frontend (not yet implemented)
- **trading-agents/** — Trading agents (not yet implemented)

## Development Commands

Each service is developed independently. Run from within the service directory.

### finbot-api

```bash
cd finbot-api
npm install

# Run in development (tsx watches for changes)
npx tsx src/index.ts

# Build
npx tsc

# Lint
npx eslint src/

# Format
npx prettier --write src/
```

### news-scraper

```bash
cd news-scraper
npm install

# Run in development
npx tsx src/index.ts

# Build
npx tsc

# Lint
npx eslint src/
```

## Architecture

### finbot-api

Feature-based module structure under `src/modules/`, each module likely owning its routes, controllers, and services:

- `auth/` — Authentication (bcrypt for password hashing)
- `billing/` — Billing logic
- `health/` — Health check endpoint
- `news/` — News querying endpoints
- `sentiment/` — Sentiment analysis results
- `signal/` — Trading signal generation/retrieval
- `usage/` — Usage tracking
- `webhooks/` — Webhook ingestion

Shared infrastructure under `src/shared/`:

- `cache/` — Redis caching layer (ioredis)
- `config/` — Environment config (dotenv + Zod validation expected)
- `db/` — Database connections
- `events/` — Internal event bus for cross-module communication
- `llm/` — LLM client integration
- `middleware/` — Express middleware (rate limiting via express-rate-limit + rate-limit-redis)
- `queues/` — Job queues
- `streaming/` — Streaming response support
- `utils/` — Shared utilities

### news-scraper

Pipeline-oriented structure:

- `scraper/` — Fetches raw news (axios + cheerio for HTML parsing)
- `pipeline/` — Processes and transforms scraped articles
- `pre-signals/` — Generates pre-signal data from processed news
- `config/` — Constants and environment config
- `types/` — Shared TypeScript types

Scheduling is handled by `node-cron`.

### Cross-service Integration

Both services share **Pinecone** as a vector database for semantic storage and retrieval of news/signals. The news-scraper ingests articles, embeds them, and stores vectors in Pinecone; finbot-api queries them for sentiment and signal endpoints.

Redis is used by finbot-api for caching and rate limiting.

## TypeScript Config

Both services use identical `tsconfig.json`: `target: ES2022`, `module: CommonJS`, strict mode, output to `dist/`, source in `src/`.

ESLint rules of note (finbot-api): unused vars are errors (args prefixed `_` are exempt), `any` is a warning.
