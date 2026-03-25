# FinBot — Full Project Guide

A complete reference for understanding what was built, every technology used, why each decision was made, and how everything connects.

---

## Table of Contents

1. [What is FinBot?](#1-what-is-finbot)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Services Deep Dive](#3-services-deep-dive)
4. [Databases and Storage](#4-databases-and-storage)
5. [Messaging and Queues](#5-messaging-and-queues)
6. [Authentication and Security](#6-authentication-and-security)
7. [Observability — Datadog](#7-observability--datadog)
8. [Containerization — Docker](#8-containerization--docker)
9. [Infrastructure — Terraform](#9-infrastructure--terraform)
10. [CI/CD — GitHub Actions](#10-cicd--github-actions)
11. [Reverse Proxy and SSL — Nginx](#11-reverse-proxy-and-ssl--nginx)
12. [DevSecOps — Security Pipeline](#12-devsecops--security-pipeline)
13. [How a Request Flows Through the System](#13-how-a-request-flows-through-the-system)
14. [Environment Variables Reference](#14-environment-variables-reference)
15. [Directory Structure Reference](#15-directory-structure-reference)

---

## 1. What is FinBot?

FinBot is a **financial news intelligence SaaS platform**. It:

- Scrapes financial news from RSS feeds and websites
- Embeds those articles into a vector database for semantic search
- Scores each article for sentiment (positive/negative effect on an asset)
- Runs multi-agent AI debates to produce BUY/SELL/HOLD trading signals
- Exposes all of this through a REST API with authentication, billing, and usage tracking

**Target users:** developers and traders who want programmatic access to financial intelligence.

**Business model:** tiered API access (FREE, STARTER, PRO, BUSINESS) billed via Stripe or Paddle.

---

## 2. High-Level Architecture

```
                        Internet
                           │
                    ┌──────▼──────┐
                    │    Nginx    │  port 80/443
                    │ (SSL proxy) │  finnbot.duckdns.org
                    └──────┬──────┘
                           │
              ┌────────────▼────────────┐
              │       finbot-api        │  port 3000 (internal)
              │   TypeScript / Express  │
              └──┬──────────┬──────────┘
                 │          │
        ┌────────▼──┐  ┌────▼────────────┐
        │ PostgreSQL│  │     Redis        │
        │  (data)   │  │ (cache + queues) │
        └───────────┘  └─────────────────┘
                 │
        ┌────────▼──────────┐
        │    RabbitMQ        │  message broker
        └────────┬───────────┘
                 │ publishes articles
        ┌────────▼──────────┐
        │   news-scraper    │  TypeScript / Node
        │  (pipeline)       │
        └────────┬───────────┘
                 │ vectors
        ┌────────▼──────────┐
        │     Pinecone       │  vector database (cloud)
        └───────────────────┘
                 │
        ┌────────▼──────────┐
        │  trading-agents   │  Python / FastAPI
        │  (LLM analysis)   │
        └───────────────────┘
                 │
        ┌────────▼──────────┐
        │  Datadog Agent    │  observability
        └───────────────────┘
```

**Key principle:** every service talks through the internal Docker network. Only Nginx is exposed to the internet.

---

## 3. Services Deep Dive

### 3.1 finbot-api

**Language:** TypeScript
**Runtime:** Node.js 22
**Framework:** Express.js 5
**Entry point:** `finbot-api/src/server.ts`

This is the main API. It handles all user-facing requests.

**Why Express?** It is the most widely-used Node.js framework, has a massive ecosystem, and is simple enough to reason about. Express 5 adds async error handling out of the box.

**Module structure** — the code is organized by feature, not by type:

```
src/modules/
  auth/         → register, login, logout, API key management
  billing/      → subscription plans, Stripe/Paddle webhooks
  health/       → GET /health (used by Docker and load balancers)
  news/         → search articles, breaking news
  sentiment/    → sentiment scores per asset
  signal/       → trading signals
  stocks/       → stock profiles, financials, analyst grades
  chat/         → LLM-powered Q&A endpoint
  analysis/     → job tracking for trading-agents results
  stream/       → real-time updates via Server-Sent Events
  usage/        → API usage tracking per user
  webhooks/     → outbound webhook delivery to user URLs
```

Each module owns its routes, controller, service, and repository. This pattern is called **feature-based architecture** — all code for one feature lives together instead of being split across `controllers/`, `services/`, etc.

**Shared infrastructure** lives in `src/shared/`:

| Directory | What it does |
|---|---|
| `config/env.ts` | Reads all environment variables and validates them with Zod at startup. If a required var is missing, the app exits immediately with a clear error. |
| `db/postgres.client.ts` | Prisma client — the interface to PostgreSQL |
| `db/pinecone.client.ts` | Pinecone client — the interface to the vector database |
| `cache/` | Two-tier cache: L1 = Redis (fast, 5 min TTL), L2 = Postgres (slower, persistent) |
| `middleware/` | Auth, rate limiting, usage tracking, correlation IDs |
| `queues/` | BullMQ workers for background jobs (sentiment scoring, analysis) |
| `rabbitmq/` | Publishes/consumes messages from news-scraper |
| `observability/metrics.ts` | Custom Datadog metrics |
| `utils/logger.ts` | Pino structured JSON logger |

---

### 3.2 news-scraper

**Language:** TypeScript
**Runtime:** Node.js 22
**Entry point:** `news-scraper/src/index.ts`

This service runs on a schedule. It has no HTTP server — it's a pipeline.

**What it does every 2 hours:**
1. **Scrape** — fetches RSS feeds and web pages for financial news
2. **Deduplicate** — skips articles already processed
3. **Normalize** — cleans and structures the raw text
4. **Categorize** — classifies articles by topic (macro, crypto, equities, etc.)
5. **Sentiment** — scores each article with HuggingFace inference
6. **Embed** — converts article text into a vector using HuggingFace embeddings
7. **Upsert** — stores the vector in Pinecone for semantic search
8. **Publish** — sends article events to RabbitMQ so finbot-api can update sentiment scores

**Why a separate service?** Scraping and embedding is CPU/network-intensive and should not block the main API. Decoupling them means the API stays fast while the pipeline runs in the background.

**Scheduling** uses `node-cron` — same concept as Linux cron jobs but inside Node.js.

---

### 3.3 trading-agents

**Language:** Python 3.13
**Framework:** FastAPI
**Entry point:** `trading-agents/main.py`

This service runs multi-agent LLM debates to produce trading signals.

**What it does:**
- Receives a request for a stock/asset analysis
- Spawns multiple AI agents with different roles (bull analyst, bear analyst, risk manager, etc.)
- Each agent reads relevant news from Pinecone and market data from yfinance
- Agents debate and challenge each other's positions
- A final decision agent produces BUY / SELL / HOLD with full reasoning

**Why Python?** The vendored `TradingAgents` library is Python-only. Python also has the best ecosystem for financial data (yfinance, pandas-ta).

**Why FastAPI?** It is the modern standard for Python APIs — async, fast, auto-generates OpenAPI docs, Pydantic validation built in.

**Why internal only?** This service does expensive LLM calls. It should only be called by finbot-api (which can control rate limiting and authentication), never directly by users.

---

## 4. Databases and Storage

### 4.1 PostgreSQL 16

**Purpose:** Main relational database. Stores all persistent business data.

**Why PostgreSQL?** It is the most reliable open-source relational database. Handles transactions, foreign keys, complex queries, and JSON columns well.

**ORM:** Prisma
**Why Prisma?** Type-safe database queries generated from the schema. Auto-generates TypeScript types. Migration system keeps the schema in sync across environments.

**Schema models:**

| Model | What it stores |
|---|---|
| `User` | Email, hashed password, subscription plan |
| `RefreshToken` | Hashed JWT refresh tokens (for logout/revocation) |
| `ApiKey` | Hashed API keys with prefix (e.g. `fb_live_...`) |
| `SentimentScore` | Per-article sentiment (-1.0 to +1.0) with label |
| `AnalysisResult` | BUY/SELL/HOLD decisions from trading-agents |
| `Webhook` | User-registered webhook URLs with HMAC secrets |
| `StockProfile` | Stock metadata (exchange, sector, AI summary) |
| `StockFinancials` | Income statements, balance sheets, cash flows |
| `UsageLog` | Every API call with latency, status code, plan |

---

### 4.2 Redis 7

**Purpose:** Three different jobs:
1. **Cache** — stores API responses for 5 minutes to avoid repeated DB/API calls
2. **Rate limiting** — tracks request counts per user per time window
3. **Pub/Sub** — real-time events for the SSE (Server-Sent Events) streaming endpoint

**Why Redis?** It is an in-memory database — extremely fast (sub-millisecond reads). Perfect for caching and rate limiting where speed matters most.

---

### 4.3 Pinecone (Vector Database)

**Purpose:** Stores embedded news articles for semantic search.

**What is a vector database?** A vector is a list of numbers (e.g. 384 numbers) that represents the *meaning* of a piece of text. Two articles about the same topic will have vectors that are mathematically close to each other, even if they use different words. Pinecone lets you search by meaning rather than exact keywords.

**Flow:**
1. news-scraper takes an article text
2. HuggingFace converts it to a 384-dimensional vector
3. That vector is stored in Pinecone with metadata (ticker, date, source)
4. When a user asks "find news about Apple earnings", finbot-api converts that query to a vector and asks Pinecone "what's close to this?"

---

## 5. Messaging and Queues

### 5.1 RabbitMQ 3.13

**Purpose:** Async communication between services.

**What is a message broker?** Instead of Service A calling Service B directly (synchronous), A drops a message into a queue and B reads it when ready (asynchronous). This decouples services — if B is down, messages wait in the queue.

**In FinBot:**
- news-scraper publishes article events to RabbitMQ after processing
- finbot-api consumes those events and updates sentiment scores in Postgres

**Why RabbitMQ over Kafka?** RabbitMQ is simpler to operate for moderate message volumes. Kafka is better at massive scale and log replay — overkill for this project.

---

### 5.2 BullMQ

**Purpose:** Job queues within finbot-api.

**Difference from RabbitMQ:** BullMQ is for background jobs *within* a single service. RabbitMQ is for messages *between* services.

**In FinBot:**
- When a user requests a trading analysis, finbot-api pushes a job to BullMQ instead of blocking the HTTP request
- A BullMQ worker picks it up, calls trading-agents, stores the result
- The user can poll for the result or get notified via webhook

**Why BullMQ?** It is backed by Redis (already in the stack), has retry logic, job prioritization, and rate limiting built in.

---

## 6. Authentication and Security

### How authentication works

FinBot supports two auth methods:

**1. JWT (JSON Web Tokens)**
- User logs in with email/password
- Server returns an `access_token` (expires in 15 minutes) and a `refresh_token` (expires in 7 days)
- Client sends `access_token` in the `Authorization: Bearer` header
- When access token expires, client uses refresh token to get a new one
- Library: `jose`

**Why short-lived access tokens?** If a token is stolen, it becomes useless in 15 minutes. The refresh token is stored in an HttpOnly cookie — JavaScript cannot read it, protecting against XSS.

**2. API Keys**
- Users generate API keys from the dashboard
- Keys are prefixed (e.g. `fb_live_abc123...`) so they're recognizable
- The actual key is only shown once — we store a hash (bcrypt), never the plain key
- Client sends the key in the `X-API-Key` header

**Why hash API keys?** Same reason you hash passwords — if the database is stolen, the attacker can't use the hashed keys.

**Rate limiting:**
- Redis tracks how many requests each user/IP has made in the current window
- Different plans have different limits (FREE: 100/hour, PRO: 10,000/hour)

**Helmet:**
- Sets security HTTP headers automatically:
  - `X-Content-Type-Options: nosniff` — browser won't guess content type
  - `X-Frame-Options: DENY` — page can't be embedded in iframes (anti-clickjacking)
  - `Content-Security-Policy` — controls what resources the page can load

---

## 7. Observability — Datadog

Observability means being able to understand what your system is doing in production. There are three pillars: **logs**, **metrics**, and **traces**.

### 7.1 Logs

**Library:** Pino
**Why Pino?** It is the fastest Node.js logger. Outputs structured JSON in production — Datadog can parse each field automatically.

**Log injection:** Because we use `dd-trace` with `logInjection: true`, every log line automatically includes `dd.trace_id` and `dd.span_id`. This lets you click a log line in Datadog and immediately jump to the trace that produced it.

**In development:** logs are pretty-printed with colors (`pino-pretty`).
**In production:** raw JSON — Datadog's log parser understands it.

---

### 7.2 Traces (APM)

**Library:** `dd-trace`
**Why import it first?** dd-trace uses monkey-patching — it wraps Node.js built-ins and popular libraries (Express, pg, Redis, BullMQ, axios) to automatically capture timing data. If anything is imported before it, the patching won't work.

```typescript
// server.ts — this MUST be the very first import
import './tracer'
```

**What traces show you:**
- Every HTTP request as a root span
- Every database query as a child span inside that request
- Every Redis call, queue job, external API call
- Full timing breakdown — where is time being spent?

**Example trace:** `GET /api/v1/news/AAPL` →
- 2ms: Redis cache lookup (miss)
- 45ms: Pinecone semantic search
- 3ms: Postgres query for metadata
- 1ms: Redis cache write
- Total: 51ms

---

### 7.3 Metrics

**File:** `finbot-api/src/shared/observability/metrics.ts`
**Protocol:** DogStatsD (UDP packets to the Datadog agent)

Custom metrics we send:

| Metric | Type | What it measures |
|---|---|---|
| `finbot.api.requests` | Counter | Every API request by plan/endpoint/status |
| `finbot.sentiment.duration` | Histogram | How long sentiment scoring takes |
| `finbot.sentiment.scored` | Counter | Number of articles scored |
| `finbot.queue.depth` | Gauge | How many jobs are waiting in BullMQ |
| `finbot.analysis.duration` | Histogram | How long a full trading analysis takes |

**Why custom metrics?** Automatic metrics (CPU, memory, request count) are captured by dd-trace. Custom metrics capture *business* logic — things specific to FinBot that Datadog wouldn't know about on its own.

---

### 7.4 Datadog Agent (Container)

The Datadog Agent runs as a sidecar container in the same Docker Compose stack. It:
- Collects logs from all containers (via Docker socket)
- Receives traces from dd-trace over port 8126
- Receives custom metrics from DogStatsD over port 8125
- Monitors container CPU/memory/network
- Forwards everything to `app.datadoghq.com`

**Unified Service Tagging:** every container has `DD_SERVICE`, `DD_ENV`, `DD_VERSION` set. This lets you filter logs, traces, and metrics by service or environment with one click in Datadog.

---

## 8. Containerization — Docker

### What is Docker?

Docker packages an application and all its dependencies into a **container** — an isolated, reproducible unit that runs the same way on any machine. No more "it works on my machine."

### Multi-stage builds

All three Dockerfiles use multi-stage builds:

```dockerfile
# Stage 1: Builder
FROM node:22-alpine AS builder
# Install ALL dependencies (including dev tools)
# Compile TypeScript → JavaScript
# Prune dev dependencies

# Stage 2: Runner (the actual image)
FROM node:22-alpine AS runner
# Copy only the compiled output from builder
# No TypeScript compiler, no test libraries, no source code
# Result: image is 3-5x smaller
```

**Why smaller images?** Smaller attack surface (fewer packages = fewer vulnerabilities). Faster to pull and start. Less storage cost.

### Container hardening

Every production container has security settings:

```yaml
security_opt:
  - no-new-privileges:true   # process can't gain more permissions than it started with
cap_drop:
  - ALL                      # drop all Linux capabilities (network raw, sys_admin, etc.)
read_only: true              # filesystem is read-only
tmpfs:
  - /tmp                     # /tmp is writable in RAM only
```

**Why these settings?**
- `no-new-privileges` — prevents privilege escalation attacks (e.g. a setuid binary)
- `cap_drop: ALL` — containers by default get ~15 Linux capabilities. We drop all of them. The app doesn't need any.
- `read_only` — if an attacker gets code execution, they can't write files to disk (no malware persistence)

### Non-root user

```dockerfile
RUN addgroup -S finbot && adduser -S finbot -G finbot
USER finbot
```

Containers run as a non-root user named `finbot`. Running as root inside a container is a security risk — if the container is compromised, root in the container can potentially escape to the host.

### Tini / dumb-init

```dockerfile
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
```

**Why tini?** Node.js is not designed to be PID 1 (the first process in a container). PID 1 is responsible for reaping zombie processes and forwarding signals. Without tini, `docker stop` sends SIGTERM to Node, but Node might not handle it correctly — leading to 10-second timeout kills instead of graceful shutdown. Tini is a minimal init system that handles this correctly.

### Docker networks

```
internal network (internal: true)
  ├── postgres
  ├── redis
  ├── rabbitmq
  ├── finbot-api
  ├── news-scraper
  └── trading-agents

public network
  ├── nginx          (needs to publish ports 80/443 to host)
  ├── datadog-agent  (needs to reach app.datadoghq.com)
  └── certbot        (needs to reach letsencrypt.org)
```

`internal: true` means containers in that network **cannot reach the internet**. They can only talk to each other. This is defense in depth — even if an attacker compromises postgres, it can't call home or download tools.

Services in `public` network can reach the internet because they need to:
- nginx: doesn't need internet, but needs port publishing to host (requires non-internal network)
- datadog-agent: must send data to Datadog's servers
- certbot: must verify domain with Let's Encrypt

### Resource limits

```yaml
deploy:
  resources:
    limits:
      memory: 512m
      cpus: '0.5'
```

Without limits, one container could consume all server memory and crash everything else. Limits ensure containers stay within their allocation. If a container exceeds its memory limit, Docker kills it (OOMKilled) rather than letting it starve others.

---

## 9. Infrastructure — Terraform

### What is Terraform?

Terraform is **Infrastructure as Code (IaC)** — you describe your cloud infrastructure in `.tf` files, and Terraform creates/updates/destroys the real resources.

**Why IaC?**
- Reproducible — rebuild the same infrastructure from scratch in minutes
- Version controlled — infrastructure changes go through Git like code
- Auditable — you can see what changed and when
- Avoids manual ClickOps mistakes

### How Terraform works

**Plan → Apply:**
1. You write `.tf` files describing the desired state
2. `terraform plan` — shows what Terraform will create/change/destroy
3. `terraform apply` — makes it happen

**State file (`terraform.tfstate`):**
Terraform tracks what it created in a state file. This is how it knows the difference between "create new" and "update existing". Never delete this file.

**Providers:**
Terraform doesn't know about DigitalOcean by default. You declare a provider and Terraform downloads the plugin.

```hcl
# versions.tf
terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}
```

### Our Infrastructure

**`main.tf` — the server:**

```hcl
resource "digitalocean_droplet" "server" {
  name      = "finbot-prod"
  image     = "ubuntu-22-04-x64"
  size      = "s-2vcpu-4gb"     # 2 vCPU, 4GB RAM, $24/month
  region    = "nyc3"
  ssh_keys  = [digitalocean_ssh_key.deploy.fingerprint]
  user_data = file("scripts/init.sh")   # runs on first boot

  lifecycle {
    ignore_changes = [user_data]   # changing init.sh won't destroy the server
  }
}
```

**`firewall.tf` — the firewall:**

Only three ports open to the internet:
- `22` — SSH (you + GitHub Actions)
- `80` — HTTP (Let's Encrypt challenge + redirect to HTTPS)
- `443` — HTTPS (all real traffic through Nginx)

Everything else is blocked. PostgreSQL (5432), Redis (6379), RabbitMQ (5672) are never exposed.

**`variables.tf` — configuration:**

Values like `do_token` and `ssh_public_key` are passed in via `terraform.tfvars` (never committed to Git) or environment variables.

**`scripts/init.sh` — server bootstrap:**

Runs once on first boot via cloud-init:
- Updates Ubuntu packages
- Installs Docker
- Creates `deploy` user with Docker and sudo access
- Copies SSH key from root to deploy user
- Creates `/opt/finbot` directory

---

## 10. CI/CD — GitHub Actions

CI/CD stands for **Continuous Integration / Continuous Deployment**.

- **CI** — every pull request automatically runs tests and checks before merging
- **CD** — every push to main automatically deploys to production

### ci.yml — what happens on every pull request

```
Pull Request opened/updated
        │
        ▼
┌─────────────────────┐    ┌─────────────────────┐
│   finbot-api job    │    │  news-scraper job   │
│   ─────────────     │    │  ─────────────────  │
│   npm ci            │    │   npm ci            │
│   npm run lint      │    │   npm run lint      │
│   npm run test      │    │   npm test          │
│   npm run build     │    │   npm run build     │
└─────────────────────┘    └─────────────────────┘
```

Both jobs run in parallel. If either fails, the PR is blocked from merging.

**Why npm ci instead of npm install?**
`npm ci` is stricter — it installs *exactly* what's in `package-lock.json` and fails if there are any discrepancies. No surprises in CI.

---

### cd.yml — what happens on every push to main

```
Push to main
      │
      ▼
Build & Push (matrix: 3 services in parallel)
  ┌──────────────────────────────────────────────────────┐
  │ finbot-api    news-scraper    trading-agents         │
  │    │               │               │                 │
  │  docker build   docker build   docker build         │
  │  docker push    docker push    docker push          │
  │ (ghcr.io)      (ghcr.io)      (ghcr.io)            │
  └──────────────────────────────────────────────────────┘
      │ (all three must succeed)
      ▼
Deploy
  │
  ├── SCP: copy docker-compose.prod.yml + nginx/ to server
  │
  └── SSH into server:
        docker login ghcr.io
        docker compose pull      ← pull new images
        docker compose up -d     ← restart updated containers
        prisma migrate deploy    ← run any new DB migrations
        docker image prune       ← clean up old images
      │
      ▼
  Notify Datadog (deployment event)
```

**GitHub Container Registry (GHCR):**
Docker images are stored at `ghcr.io/ahmedk20/finbot/`. This is free with GitHub and integrates with GitHub Actions auth automatically.

**Matrix strategy:**
All three services build simultaneously instead of sequentially — cuts build time by ~3x.

**Image tags:**
Every image is pushed with two tags:
- `latest` — always points to the newest build
- `abc123def...` (commit SHA) — immutable, lets you roll back to any specific commit

**Secrets in GitHub Actions:**
Sensitive values (SSH keys, API keys) are stored in GitHub → Settings → Secrets. They're available as `${{ secrets.SECRET_NAME }}` and are never printed in logs.

---

### security.yml — automated security scanning

Runs on every push to main, four jobs:

**1. Gitleaks — secret scanning**
Scans every commit for accidentally committed secrets (API keys, passwords, tokens). If a secret is found in the diff, the pipeline fails immediately.

**2. npm audit — dependency vulnerabilities**
- `finbot-api`: `--audit-level=critical` (only fail on critical vulns, because Prisma has known high-severity advisories that are false positives in our use case)
- `news-scraper`: `--audit-level=high`

**3. pip-audit — Python dependency vulnerabilities**
Same concept as npm audit but for Python packages.

**4. Trivy — container filesystem scan**
Scans the finbot-api source code for known vulnerabilities in packages.

**5. CodeQL — static analysis**
GitHub's static analysis engine. Reads JavaScript and Python source code and looks for security bugs (SQL injection patterns, XSS, insecure deserialization, etc.).

---

## 11. Reverse Proxy and SSL — Nginx

### What is a reverse proxy?

A reverse proxy sits in front of your services and forwards requests to them. Users only ever talk to Nginx — they never know finbot-api exists on port 3000.

```
User → https://finnbot.duckdns.org → Nginx:443 → finbot-api:3000
```

**Why not expose finbot-api directly?**
- SSL termination happens at Nginx — services don't need to handle certs
- One entry point for all traffic — easier to add rate limiting, DDoS protection, logging
- Hides internal ports — port 3000 is not open to the internet

### How SSL/TLS works

SSL (now called TLS) encrypts traffic between the browser and your server. Without it, everything is plaintext — anyone on the network can read your users' API keys and data.

To use HTTPS you need a **certificate** — a file that proves you own the domain, signed by a trusted Certificate Authority (CA).

**Let's Encrypt** is a free CA. They use a challenge-response protocol to prove you control the domain:
1. You ask for a cert for `finnbot.duckdns.org`
2. Let's Encrypt says: "put this file at `http://finnbot.duckdns.org/.well-known/acme-challenge/XYZ`"
3. Certbot puts the file there (via the `/var/www/certbot` shared volume)
4. Let's Encrypt fetches it — if it works, they sign and issue the cert
5. Cert expires in 90 days → Certbot renews automatically

### nginx.conf explained

```nginx
# HTTP server — handles ACME challenge and redirects everything else to HTTPS
server {
    listen 80;
    server_name finnbot.duckdns.org;

    # Let's Encrypt verification files
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect all HTTP to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS server — the real entry point
server {
    listen 443 ssl;
    server_name finnbot.duckdns.org;

    ssl_certificate     /etc/letsencrypt/live/finnbot.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/finnbot.duckdns.org/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;   # Only modern TLS — no TLS 1.0/1.1

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000" always;
    # ^ HSTS: tells browsers "always use HTTPS for this domain for 1 year"
    # ^ This prevents SSL stripping attacks

    add_header X-Frame-Options DENY always;
    # ^ Prevents your API from being embedded in an iframe

    add_header X-Content-Type-Options nosniff always;
    # ^ Browser won't guess the content type — prevents MIME-type confusion attacks

    # Forward all requests to finbot-api
    location / {
        proxy_pass http://finbot-api:3000;
        proxy_set_header X-Forwarded-Proto $scheme;
        # ^ Tells finbot-api that the original request was HTTPS
        # ^ Without this, the app would think all requests are HTTP
    }
}
```

### The bootstrap problem

When Nginx first starts, it tries to load `nginx.conf` which references the SSL cert files. But the cert doesn't exist yet — we haven't run Certbot yet. Nginx crashes.

Solution: two-phase bootstrap:
1. Start Nginx with `nginx.bootstrap.conf` (HTTP only, no SSL block)
2. Run Certbot to issue the cert
3. Copy `nginx.conf` over the bootstrap config
4. `nginx -s reload` — Nginx reloads config without downtime

After this, Certbot runs every 12 hours in the background and renews automatically.

---

## 12. DevSecOps — Security Pipeline

DevSecOps means security is not an afterthought — it's integrated into the development pipeline from the start.

### The security pipeline (security.yml)

Every push to main runs these checks automatically:

| Check | Tool | What it finds |
|---|---|---|
| Secret scanning | Gitleaks | API keys, passwords, tokens committed to Git |
| JS dependency audit | npm audit | Known CVEs in npm packages |
| Python dependency audit | pip-audit | Known CVEs in Python packages |
| Container scanning | Trivy | Vulnerabilities in the file system |
| Static analysis | CodeQL | SQL injection, XSS, insecure code patterns |

### Why this matters for a portfolio project

Security scanning on a portfolio project demonstrates that you understand security is not optional. It also shows recruiters that you know how to use industry-standard tools (Trivy is used at many companies, CodeQL is GitHub's own tool).

### Container security summary

| Control | Why |
|---|---|
| Non-root user | Limits blast radius if container is compromised |
| Read-only filesystem | Prevents malware persistence after code execution |
| cap_drop: ALL | Removes all Linux capabilities — container can't do privileged operations |
| no-new-privileges | Prevents privilege escalation via setuid binaries |
| Resource limits | Prevents one container from starving others (denial of service) |
| Internal network | Database ports never exposed to internet |
| Firewall | Only ports 22, 80, 443 reachable from outside |

---

## 13. How a Request Flows Through the System

Let's trace a real request: **"Get sentiment for AAPL"**

```
1. User sends:
   GET https://finnbot.duckdns.org/api/v1/sentiment/AAPL
   Authorization: Bearer eyJhbGci...

2. DNS resolves finnbot.duckdns.org → 104.236.35.121
   Firewall allows port 443

3. Nginx receives request on port 443
   ├── Terminates SSL (decrypts)
   ├── Adds X-Forwarded-Proto: https header
   └── Forwards to http://finbot-api:3000/api/v1/sentiment/AAPL

4. finbot-api receives request
   ├── correlationId middleware: generates request ID, attaches to logs
   ├── auth middleware: validates JWT, loads user from DB
   ├── rateLimit middleware: checks Redis counter for this user
   ├── trackUsage middleware: will log this request to UsageLog table
   └── routes request to sentiment module

5. sentiment controller → sentiment service:
   ├── Check Redis cache (L1): cache miss
   ├── Check Postgres (L2): cache miss (cold start)
   ├── Query Postgres for AAPL sentiment scores (last 24h)
   ├── Store result in Redis cache (TTL: 5 min)
   └── Return scores

6. metrics.ts sends DogStatsD packet:
   finbot.api.requests (tags: plan:pro, endpoint:/sentiment, status:200)

7. Response flows back:
   finbot-api → Nginx (re-encrypts SSL) → User

8. Datadog agent:
   ├── Receives trace from dd-trace (full request timeline)
   ├── Correlates with Pino log lines via trace_id
   └── Forwards to app.datadoghq.com

Total time: ~50ms
```

---

## 14. Environment Variables Reference

### finbot-api

| Variable | Purpose | Example |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `NODE_ENV` | Environment | `production` |
| `DATABASE_URL` | Postgres connection string | `postgresql://user:pass@postgres:5432/finbot` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `PINECONE_API_KEY` | Pinecone API key | `pcsk_...` |
| `PINECONE_INDEX_NAME` | Pinecone index | `finbot-index` |
| `HUGGINGFACE_API_KEY` | HuggingFace token | `hf_...` |
| `API_KEY_SECRET` | HMAC secret for API key generation | 32+ char hex |
| `JWT_ACCESS_SECRET` | JWT signing key | 32+ char hex |
| `JWT_REFRESH_SECRET` | JWT refresh signing key | 32+ char hex |
| `JWT_ACCESS_EXPIRES_IN` | Access token TTL | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL | `7d` |
| `INTERNAL_KEY` | Shared secret with trading-agents | 32+ char hex |
| `TRADING_AGENTS_URL` | trading-agents URL | `http://trading-agents:8000` |
| `BILLING_PROVIDER` | Which billing provider | `stripe` or `paddle` |
| `BILLING_SECRET_KEY` | Stripe/Paddle secret key | `sk_live_...` |
| `FMP_API_KEY` | Financial Modeling Prep key | — |
| `RABBITMQ_URL` | RabbitMQ connection string | `amqp://user:pass@rabbitmq:5672` |

### news-scraper

| Variable | Purpose |
|---|---|
| `PINECONE_API_KEY` | Same index as finbot-api |
| `HUGGINGFACE_API_KEY` | For embeddings |
| `RABBITMQ_URL` | Publishes article events |
| `SCRAPER_CRON_SCHEDULE` | Cron for scraping (default: every 2h) |
| `SCRAPER_CONCURRENCY` | Parallel article processing |

### trading-agents

| Variable | Purpose |
|---|---|
| `INTERNAL_KEY` | Must match finbot-api's INTERNAL_KEY |
| `GROQ_API_KEY` | Groq LLM API |
| `GEMINI_API_KEY` | Google Gemini API |
| `OPENAI_API_KEY` | OpenAI API |
| `TA_MAX_DEBATE_ROUNDS` | How many debate rounds per analysis |
| `FRED_API_KEY` | Federal Reserve economic data |

---

## 15. Directory Structure Reference

```
finbot/
│
├── .github/
│   └── workflows/
│       ├── ci.yml          → tests on pull requests
│       ├── cd.yml          → deploy on push to main
│       └── security.yml    → security scans on push to main
│
├── finbot-api/             → Main TypeScript API
│   ├── src/
│   │   ├── server.ts       → entry point (starts server)
│   │   ├── app.ts          → Express app (routes, middleware)
│   │   ├── tracer.ts       → Datadog APM init (must be first import)
│   │   ├── modules/        → feature modules (auth, billing, news, etc.)
│   │   └── shared/         → infrastructure (db, cache, queue, logger, etc.)
│   ├── prisma/
│   │   ├── schema.prisma   → database schema
│   │   └── migrations/     → SQL migration files
│   ├── Dockerfile          → multi-stage build
│   └── package.json
│
├── news-scraper/           → TypeScript scraping pipeline
│   ├── src/
│   │   ├── index.ts        → entry point (cron schedules)
│   │   ├── tracer.ts       → Datadog APM init
│   │   ├── scraper/        → RSS/web scraping
│   │   ├── pipeline/       → normalize → embed → upsert
│   │   └── pre-signals/    → generate pre-signal context
│   ├── Dockerfile
│   └── package.json
│
├── trading-agents/         → Python FastAPI analysis service
│   ├── main.py             → FastAPI app
│   ├── src/                → routers (analysis, llm, indicators, data)
│   ├── vendor/             → vendored TradingAgents library
│   ├── Dockerfile
│   └── requirements.txt
│
├── nginx/
│   ├── nginx.conf          → production config (HTTP redirect + HTTPS proxy)
│   └── nginx.bootstrap.conf → temporary config for initial cert issuance
│
├── infra/                  → Terraform infrastructure
│   ├── main.tf             → DigitalOcean droplet
│   ├── firewall.tf         → firewall rules
│   ├── variables.tf        → input variables
│   ├── versions.tf         → provider versions
│   ├── outputs.tf          → server IP, SSH command
│   └── scripts/init.sh     → server bootstrap (runs on first boot)
│
├── docker-compose.yml      → local development (postgres, redis, rabbitmq)
├── docker-compose.prod.yml → production (all 9 services)
├── .gitattributes          → enforce LF line endings (prevents Windows CRLF bugs)
└── GUIDE.md                → this file
```

---

## Quick Reference: What Technology Does What

| You want to... | Technology |
|---|---|
| Serve HTTP/HTTPS to users | Nginx |
| Handle API requests | Express.js (finbot-api) |
| Validate request bodies | Zod |
| Authenticate users | JWT (jose) + bcrypt |
| Store business data | PostgreSQL + Prisma |
| Cache API responses | Redis |
| Rate limit requests | Redis + express-rate-limit |
| Scrape financial news | Axios + Cheerio + rss-parser |
| Find articles by meaning | Pinecone (vector search) |
| Convert text to vectors | HuggingFace Inference API |
| Score article sentiment | HuggingFace Inference API |
| Run LLM trading analysis | LiteLLM + TradingAgents (Python) |
| Pass messages between services | RabbitMQ |
| Run background jobs | BullMQ |
| Stream real-time updates | Server-Sent Events (SSE) + Redis pub/sub |
| Bill users | Stripe / Paddle |
| Log everything | Pino |
| Trace requests end-to-end | Datadog APM (dd-trace) |
| Send custom metrics | Datadog DogStatsD |
| Containerize services | Docker |
| Orchestrate containers | Docker Compose |
| Provision cloud server | Terraform + DigitalOcean |
| Deploy automatically | GitHub Actions (CI/CD) |
| Store Docker images | GitHub Container Registry (GHCR) |
| Manage SSL certificates | Certbot + Let's Encrypt |
| Scan for secrets in code | Gitleaks |
| Audit JS dependencies | npm audit |
| Audit Python dependencies | pip-audit |
| Scan containers for CVEs | Trivy |
| Static security analysis | CodeQL |
