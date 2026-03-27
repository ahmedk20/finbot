# FinBot

> Financial news intelligence API — scrape, analyze, and act on crypto and stock news in real time.

[![CI](https://github.com/ahmedk20/finbot/actions/workflows/ci.yml/badge.svg)](https://github.com/ahmedk20/finbot/actions/workflows/ci.yml)
[![CD](https://github.com/ahmedk20/finbot/actions/workflows/cd.yml/badge.svg)](https://github.com/ahmedk20/finbot/actions/workflows/cd.yml)
[![Security](https://github.com/ahmedk20/finbot/actions/workflows/security.yml/badge.svg)](https://github.com/ahmedk20/finbot/actions/workflows/security.yml)

---

## What is FinBot?

FinBot is a production-grade SaaS API platform that:

- Scrapes **20+ crypto and financial news sources** every 2 hours via RSS
- Scores every article with **FinBERT** — a finance-specific NLP sentiment model
- Stores articles as **vector embeddings** in Pinecone for semantic search
- Runs **multi-agent AI debates** (bull analyst vs. bear analyst) to produce BUY / SELL / HOLD signals
- Exposes everything through a **REST API** with authentication, billing tiers, rate limiting, and webhooks

**Target users:** developers and traders who want programmatic access to financial intelligence without building the data pipeline themselves.

**Live API:** `https://finnbot.duckdns.org/health`

---

## Architecture

```
                        Internet
                           │
                    ┌──────▼──────┐
                    │    Nginx    │  port 80/443
                    │  (SSL/TLS)  │  finnbot.duckdns.org
                    └──────┬──────┘
                           │
              ┌────────────▼────────────┐
              │       finbot-api        │  :3000 (internal)
              │   TypeScript / Express  │
              └──┬──────┬──────────────┘
                 │      │
        ┌────────▼─┐  ┌─▼──────┐   ┌─────────────────┐
        │ Postgres │  │ Redis  │   │    RabbitMQ      │
        │ (data)   │  │(cache) │   │ (event bus)      │
        └──────────┘  └────────┘   └────────┬─────────┘
                                            │ consumes
                                   ┌────────▼─────────┐
                                   │   news-scraper   │  TypeScript
                                   │   (pipeline)     │
                                   └────────┬─────────┘
                                            │ vectors
                                   ┌────────▼─────────┐
                                   │    Pinecone      │  vector DB (cloud)
                                   └────────┬─────────┘
                                            │ queries
                                   ┌────────▼─────────┐
                                   │ trading-agents   │  Python / FastAPI
                                   │  (LLM analysis)  │
                                   └──────────────────┘

   Datadog Agent ─────────── observes all containers (logs + traces + metrics)
```

**Key principle:** every service communicates over the internal Docker network. Only Nginx is exposed to the internet. `trading-agents` is internal-only — never reachable directly by users.

---

## Services

| Service | Language | Role |
|---|---|---|
| `finbot-api` | TypeScript / Node.js 22 | Main REST API — auth, billing, news, signals, webhooks |
| `news-scraper` | TypeScript / Node.js 22 | Scheduled pipeline — scrape → embed → store in Pinecone |
| `trading-agents` | Python 3.13 / FastAPI | Multi-agent LLM analysis → BUY/SELL/HOLD decisions |
| `dashboard` | — | Frontend (not yet implemented — open for collaboration) |

---

## Tech Stack

### Backend
| Technology | Purpose |
|---|---|
| **Express.js 5** | HTTP server and routing |
| **TypeScript** (strict mode) | Type-safe Node.js |
| **Prisma ORM** | Type-safe PostgreSQL queries + migrations |
| **FastAPI** | Python async API for trading-agents |
| **Zod** | Runtime schema validation for all inputs |
| **jose** | JWT access + refresh token auth |
| **Pino** | Structured JSON logging |

### Databases & Storage
| Technology | Purpose |
|---|---|
| **PostgreSQL 16** | Users, API keys, usage logs, billing, webhooks |
| **Redis 7** | L1 cache (5 min TTL) + rate limiting + SSE pub/sub |
| **Pinecone** | Vector database — 2,700+ news articles as embeddings |

### Messaging & Queues
| Technology | Purpose |
|---|---|
| **RabbitMQ 3.13** | Async events between news-scraper and finbot-api |
| **BullMQ** | Background job queue within finbot-api (backed by Redis) |

### AI / ML
| Technology | Purpose |
|---|---|
| **FinBERT** | Finance-specific sentiment analysis (bullish / bearish / neutral) |
| **HuggingFace Inference API** | Text embedding (384-dimensional vectors) |
| **TradingAgents** | Multi-agent LLM framework (vendored) |
| **LiteLLM** | Unified LLM client — swap models without changing code |
| **yfinance + pandas-ta** | Market data and technical indicators |

### Infrastructure & DevOps
| Technology | Purpose |
|---|---|
| **Docker + Docker Compose** | Containerized stack — 6 services |
| **Terraform** | Infrastructure as Code — DigitalOcean provisioning |
| **Nginx** | Reverse proxy + SSL termination |
| **Let's Encrypt / Certbot** | Free HTTPS certificates (auto-renew) |
| **GitHub Actions** | CI/CD — test on every PR, deploy on merge to main |
| **Datadog** | APM, logs, traces, custom metrics |

---

## API Endpoints

All endpoints require authentication via `Authorization: Bearer <token>` or `X-API-Key: fb_live_...`

### News
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/news` | Semantic news search (filter by asset, sentiment, severity) |
| `GET` | `/api/v1/news/breaking` | Breaking news from tier1/tier2 sources (last 2h) |
| `GET` | `/api/v1/news/:id` | Single article by ID |
| `GET` | `/api/v1/news/:id/context` | Article + historically similar events with price outcomes |

### Sentiment
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/sentiment/:asset` | Aggregated sentiment score for an asset |
| `GET` | `/api/v1/sentiment/:asset/history` | Sentiment trend over time |

### Trading Signals
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/signal/analyze` | Start an AI analysis job (async) |
| `GET` | `/api/v1/signal/analyze/:jobId` | Poll job status and get BUY/SELL/HOLD result |
| `GET` | `/api/v1/signal/latest/:asset` | Latest cached signal for an asset |

### Stocks
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/stocks/:ticker` | Profile, price snapshot, AI summary |
| `GET` | `/api/v1/stocks/:ticker/financials` | Income statement, balance sheet, cash flow |
| `GET` | `/api/v1/stocks/:ticker/analysts` | Analyst grades + price target consensus |

### Auth
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Create account |
| `POST` | `/api/v1/auth/login` | Get access + refresh tokens |
| `POST` | `/api/v1/auth/refresh` | Rotate access token |
| `POST` | `/api/v1/auth/logout` | Revoke refresh token |
| `POST` | `/api/v1/auth/keys` | Generate API key |
| `DELETE` | `/api/v1/auth/keys/:id` | Revoke API key |

### Webhooks
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/webhooks` | Register webhook URL for events |
| `GET` | `/api/v1/webhooks` | List your webhooks |
| `DELETE` | `/api/v1/webhooks/:id` | Delete webhook |

Supported webhook events: `sentiment_change`, `analysis_done`, `signal_change`, `news_alert`

---

## Authentication

FinBot supports two auth methods:

**JWT (dashboard sessions)**
- `POST /auth/login` returns an `access_token` (15 min) and a `refresh_token` (7 days, HttpOnly cookie)
- Send `Authorization: Bearer <access_token>` on every request
- Refresh tokens are hashed with SHA-256 before storage — never stored in plain text

**API Keys (programmatic access)**
- Generate from `/auth/keys`
- Keys are prefixed:  — recognizable at a glance
- Stored as bcrypt hashes — the raw key is shown only once at creation

---

## Billing Plans

| Plan | Requests/hour | Features |
|---|---|---|
| FREE | 100 | News search, basic sentiment |
| STARTER | 1,000 | + Breaking news, webhooks |
| PRO | 10,000 | + Trading signals, historical context |
| BUSINESS | Unlimited | + Priority support, custom integrations |

Billing handled via Stripe (cards) or Paddle (international).

---

## Local Development

### Prerequisites

- Docker + Docker Compose
- Node.js 22
- Python 3.13

### 1. Clone and configure

```bash
git clone https://github.com/ahmedk20/finbot.git
cd finbot
```

Copy the example env files and fill in your keys:

```bash
cp finbot-api/.env.example finbot-api/.env
cp news-scraper/.env.example news-scraper/.env
cp trading-agents/.env.example trading-agents/.env
```

Required keys: `DATABASE_URL`, `REDIS_URL`, `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`, `HUGGINGFACE_API_KEY`, `JWT_SECRET`

### 2. Start the stack

```bash
docker compose up -d
```

This starts: `postgres`, `redis`, `rabbitmq`, `finbot-api`, `news-scraper`, `trading-agents`

### 3. Run database migrations

```bash
docker exec finbot-api npx prisma migrate deploy
```

### 4. Verify

```bash
curl http://localhost:3000/health
# → {"status":"ok","db":"ok","redis":"ok","queues":"ok"}
```

### Development (hot reload)

```bash
# finbot-api
cd finbot-api && npm install && npx tsx src/index.ts

# news-scraper
cd news-scraper && npm install && npx tsx src/index.ts
```

---

## Running Tests

```bash
cd finbot-api

# Requires postgres and redis running (docker compose up -d)
npm test
```

**139 tests** across 16 test files. Integration tests run against real Postgres and Redis — no mocks. This caught real bugs that mocked tests would have missed.

```bash
npm run lint    # ESLint
npm run build   # TypeScript compile check
```

---

## CI/CD Pipeline

```
git push → GitHub Actions

CI (every push/PR):
  ├── npm ci
  ├── npx prisma migrate deploy  (against CI postgres)
  ├── npm test  (139 tests, real DB + Redis)
  └── npm run build

CD (merge to main, CI passes):
  ├── docker build + push to GHCR
  ├── SCP docker-compose.prod.yml + nginx/ to server
  ├── SSH → docker compose pull + up -d
  └── npx prisma migrate deploy  (production)

Security (every push to main):
  ├── Gitleaks        — secret scanning
  ├── npm audit       — JS dependency CVEs
  ├── pip-audit       — Python dependency CVEs
  └── Trivy           — Docker image scanning (HIGH/CRITICAL = fail)
```

---

## Security

| Layer | What's in place |
|---|---|
| **Transport** | HTTPS enforced, HTTP redirects to HTTPS, HSTS header |
| **Headers** | Helmet.js — CSP, X-Frame-Options, X-Content-Type-Options |
| **Auth** | Bcrypt passwords, hashed API keys, short-lived JWTs, HttpOnly refresh cookies |
| **Rate limiting** | Per-user Redis sliding window, plan-based limits |
| **Container** | Non-root user, `cap_drop: ALL`, `no-new-privileges`, read-only filesystem |
| **Network** | All services on internal Docker network, only Nginx exposed |
| **SSH** | Password auth disabled, fail2ban active (brute force protection) |
| **Webhooks** | HMAC-SHA256 signed payloads — receivers can verify authenticity |
| **Pipeline** | Gitleaks + Trivy + pip-audit + npm audit on every push |

---

## Observability

Powered by **Datadog**:

- **APM Traces** — every HTTP request, DB query, Redis call, and queue job is traced end-to-end
- **Logs** — structured JSON via Pino, correlated with traces via `dd.trace_id`
- **Custom Metrics** — `finbot.api.requests`, `finbot.sentiment.scored`, `finbot.queue.depth`, `finbot.analysis.duration`
- **Container Monitoring** — CPU, memory, and network for all 6 containers

`dd-trace` is imported as the very first line in `server.ts` — this is required for monkey-patching to work correctly.

---

## Infrastructure

Provisioned with **Terraform** on **DigitalOcean**:

```bash
cd infra
terraform init
terraform apply
```

Key design decisions:
- `lifecycle { ignore_changes = [user_data] }` — prevents accidental server recreation when init scripts change
- Firewall: only ports 22, 80, 443 open inbound
- Deploy user with Docker access and NOPASSWD sudo (no root login)

---

## Project Structure

```
finbot/
├── finbot-api/          # Main TypeScript API
│   ├── src/
│   │   ├── modules/     # Feature-based modules (auth, news, signal, ...)
│   │   └── shared/      # Shared infra (db, cache, queues, middleware)
│   ├── prisma/          # Schema + migrations
│   └── Dockerfile
├── news-scraper/        # TypeScript scraping pipeline
│   └── src/
│       ├── scraper/     # RSS fetching + deduplication
│       ├── pipeline/    # Normalize → embed → upsert to Pinecone
│       └── pre-signals/ # On-chain, derivatives, social data adapters
├── trading-agents/      # Python FastAPI + LLM agents
├── nginx/               # Nginx config (bootstrap + production)
├── infra/               # Terraform (DigitalOcean)
├── .github/workflows/   # CI, CD, Security pipelines
├── docker-compose.yml        # Local development
├── docker-compose.prod.yml   # Production
└── GUIDE.md             # Deep-dive documentation for every technology used
```

---

## Looking for Collaborators

The **dashboard** service is not yet implemented. If you're a frontend developer interested in building a trading dashboard on top of this API, open an issue or reach out directly.

---

## License

MIT
