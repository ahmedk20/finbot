# FinBot — Interview Guide

A reference for explaining this project confidently in an interview. It covers the
60-second pitch, the architecture, the deep technical decisions, and the questions
you're most likely to get — with answers grounded in what's actually in the repo.

> **Accuracy note:** this guide is written against the **real source code**
> (`finbot-api/src`, `news-scraper/src`, `trading-agents/src`), not the older
> `saas/SERVICES.md` design doc, which predates the build and is outdated in places
> (it describes per-provider LLM clients, a WebSocket server, and extra queue workers
> that don't exist). Where they differ, trust this guide and the code.

---

## 1. The 30–60 Second Pitch

> "FinBot is a production-grade SaaS API that turns financial news into trading
> intelligence. It scrapes 20+ crypto and financial news sources every 2 hours,
> scores each article with FinBERT (a finance-specific sentiment model), stores
> everything as vector embeddings in Pinecone for semantic search, and runs a
> multi-agent LLM pipeline — a bull analyst and bear analyst debate — to produce
> BUY / SELL / HOLD signals. All of that is exposed through a REST API with JWT +
> API-key auth, Stripe/Paddle billing tiers, Redis rate limiting, and webhooks.
> It's four containerized services behind Nginx, deployed to DigitalOcean with
> Terraform and a full GitHub Actions CI/CD pipeline, observed with Datadog."

**One-liner if they want it shorter:** "A financial-news-to-signal API platform —
scrape, embed, score sentiment, run multi-agent analysis, serve over an
authenticated, rate-limited, billed REST API."

---

## 2. Why This Project Is Interesting (talking points)

These are the things that make it more than a CRUD app — lead with them:

1. **Multiple architectural patterns done deliberately** — a modular monolith
   (finbot-api), a Python ML microservice (trading-agents), a scheduled pipeline
   (news-scraper), all communicating over an internal Docker network.
2. **Two-stage AI pipeline** — cheap, fast FinBERT pre-scoring at ingest time, then
   expensive multi-agent LLM analysis only on demand (Pro tier). Cost-aware by design.
3. **Vector search as a first-class data store** — Pinecone holds 2,700+ articles
   plus a historical archive, enabling semantic search and "find similar past events
   and what the price did next."
4. **Real production concerns** — auth, billing, rate limiting, observability,
   security scanning, IaC, async job queues, circuit breakers, graceful degradation.
5. **Integration tests against real Postgres + Redis** (no mocks) — caught real bugs.

---

## 3. System Architecture

```
Internet → Nginx (SSL/TLS, only public entrypoint)
              │
         finbot-api (TypeScript / Express) :3000
          ├── Postgres 16   (users, keys, usage, billing, results)
          ├── Redis 7       (cache + rate limit + SSE pub/sub)
          └── RabbitMQ 3.13 (event bus, fanout exchange "finbot.events")
                   ▲ consumes events
                   │
              news-scraper (TypeScript cron pipeline)
                   │ publishes events            └─→ Pinecone (vectors)
                   │
  finbot-api ──────┴─→ trading-agents (Python / FastAPI, internal-only)
        HTTP, X-Internal-Key      = the AI + market-data brain
                                    (LLM completions, multi-agent analysis,
                                     indicators, fundamentals, on-chain,
                                     insiders, FRED macro, price history)

Datadog agent observes all containers.
```

**Key principle to state out loud:** *Only Nginx is exposed to the internet.*
`trading-agents` is internal-only — never reachable directly by users, protected by
an `X-Internal-Key` header. This is a security boundary, not an accident.

**Second key principle:** `finbot-api` does **no LLM or market-data work itself**. It
holds **one** HTTP client (`shared/llm/llm.client.ts`) that calls the Python
`trading-agents` service for *everything* AI/quant — completions, analysis, technical
indicators, fundamentals, on-chain, insiders, macro, price history. finbot-api is the
orchestrator (auth, billing, caching, queueing, serving); trading-agents is the brain.
(The exception: the `stocks` module also calls FMP/Polygon directly via
`shared/market/*` for raw profile/price data.)

### The four services

| Service | Stack | Role |
|---|---|---|
| `finbot-api` | TS / Node 22 / Express 5 | Main REST API: auth, billing, news, sentiment, analysis, signal, stocks, chat, stream, usage, webhooks |
| `news-scraper` | TS / Node 22 / node-cron | Scrape → normalize → dedupe → embed → FinBERT score → upsert Pinecone → publish RabbitMQ events |
| `trading-agents` | Python 3.13 / FastAPI | AI + market-data brain: LLM completions (LiteLLM), multi-agent analysis → BUY/SELL/HOLD, indicators, fundamentals, on-chain, insiders, FRED, price history (internal-only) |
| `dashboard` | Next.js (planned) | Frontend — not yet implemented |

---

## 4. The Request Lifecycle (be able to walk through one end-to-end)

**A. Ingest (background, no user involved)**
1. `news-scraper` cron fires every 2 hours.
2. Fetches RSS feeds in parallel (p-limit caps concurrency to be a polite scraper).
3. Normalizes to a standard `Article` shape, deduplicates by URL + title hash.
4. Filters spam and articles older than 48h.
5. Batch-embeds text (headline + first 200 chars) → 384-dim vectors via HuggingFace.
6. Pre-scores sentiment with FinBERT.
7. Upserts to Pinecone with `id = SHA256(url)` and full metadata (asset, sentiment, source tier).
8. **Publishes an event to the RabbitMQ `finbot.events` fanout exchange.** finbot-api
   consumes it (manual ack, prefetch 1, at-least-once) and can enqueue a sentiment
   re-score job and/or fan out to SSE clients. Publishing is fire-and-forget — if
   RabbitMQ is down the scraper keeps processing articles.

**B. Read sentiment (synchronous, cheap)**
1. Request hits Nginx → finbot-api.
2. Auth middleware validates JWT or API key.
3. Rate-limit middleware checks the Redis sliding window for the user's plan.
4. Tier middleware confirms the plan has access to the feature.
5. Service checks L1 (in-memory) → L2 (Redis) cache; on miss, reads pre-computed
   `SentimentScore` rows from Postgres (scores are produced by the BullMQ
   `sentiment` worker, which calls trading-agents — not computed on the request path).
6. Returns the aggregated score.

**C. Analysis / trading signal (asynchronous, expensive)**
1. `POST /api/v1/analysis` validates input (Zod) and enqueues a **BullMQ** job, returning a `jobId` immediately. The jobId is **`analysis:{asset}:{date}`**, which gives free **deduplication** — the same asset+date requested twice returns the same job instead of running twice.
2. The `analysis` worker (concurrency **1** — it's LLM/CPU heavy) classifies the asset via trading-agents, picks the analyst set (**crypto skips the fundamentals analyst** — no P/E for BTC), normalizes the ticker (`-USD` suffix for crypto), then calls trading-agents `/analyze/`.
3. trading-agents runs the analysts **in parallel** with `asyncio.gather`, then the bull/bear debate, then the risk manager last.
4. The worker **upserts** the result to Postgres (`AnalysisResult`, keyed by jobId so retries don't duplicate), invalidates the "latest" Redis cache, and **fires `analysis_done` webhooks** (fire-and-forget — a delivery error never fails the job).
5. Client polls `GET /api/v1/analysis/:jobId` (status `waiting`/`active`/`completed`/`failed`) — or registers a webhook. `GET /api/v1/signal/latest/:asset` returns the cached latest signal.

> Two points to land: (1) the async job pattern — analysis takes 15–120s, so you
> never block an HTTP request; enqueue, return jobId, poll or webhook. (2) the jobId
> *is* the dedup key, so identical concurrent requests collapse into one run.

---

## 5. finbot-api — Deep Dive

### Modular monolith, not microservices
One deployable unit, organized by **domain module**, not by layer. Each module
(`auth`, `news`, `sentiment`, `signal`, `analysis`, `stocks`, `chat`, `billing`,
`webhooks`, `usage`, `health`, `stream`) owns its own:

```
<module>.routes.ts       # endpoints
<module>.controller.ts   # request/response handling
<module>.service.ts      # business logic
<module>.repository.ts   # data access (Prisma / Pinecone)
<module>.schema.ts       # Zod validation
<module>.types.ts        # TS interfaces
index.ts                 # public API — the ONLY thing other modules may import
```

**Module boundary rules** (a strong thing to mention — shows you think about coupling):
- Modules may import from `shared/*` but **`shared/*` never imports from `modules/*`**.
- Modules talk to each other only via the typed **event bus** or another module's
  `index.ts` public exports — never by reaching into another module's internals.
- This gives microservice-like decoupling without the operational cost of distributed
  systems. "I can extract a module into its own service later if I need to."

### Shared infrastructure (`src/shared/`) — what's actually there
- **cache/** — `l1.cache.ts` (in-process Map) + `l2.cache.ts` (Redis). Two-tier.
- **llm/** — **one** client, `llm.client.ts`. It is *not* a set of provider SDKs; it's
  a thin HTTP client to the Python trading-agents service, wrapped in a **circuit
  breaker**. Exposes `complete()` (`/llm/complete`), `analyze()` (`/analyze/`, up to
  600s via a custom undici agent), `getIndicators()`, `getAssetType()`,
  `getFundamentals()`, `getOnchain()`, `getInsiders()`, `getPriceAt()`,
  `getEconomicData()`. The actual LLM provider fallback chain
  (**Groq → Gemini → OpenAI → Anthropic via LiteLLM**) lives in the Python service.
- **market/** — `fmp.client.ts` + `polygon.client.ts`: direct market-data providers
  for the `stocks` module (profiles, prices) — the one AI/data path that bypasses
  trading-agents.
- **db/** — Prisma write client (`postgres.client.ts`) + read-replica client
  (`postgres.read.ts`); Pinecone client.
- **queues/** — BullMQ, **two** queues only: `analysis` and `sentiment` (each with its
  own worker). There is **no** dedicated webhook/signal/email worker — webhooks are
  fired inline (fire-and-forget) from the analysis worker via `fireWebhooks()`.
- **streaming/** — **SSE, not WebSocket**: `sse.ts` (Server-Sent Events) +
  `redis.pubsub.ts` for cross-instance fan-out. Surfaced by the `stream` module.
- **rabbitmq/** — client, publisher, consumer, setup. The consumer uses **manual ack
  (at-least-once)**, `prefetch(1)`, requeue on handler failure, and nack-without-requeue
  for poison-pill (unparseable) messages.
- **middleware/** — `auth`, `rateLimit`, `tier`, `correlationId` (X-Correlation-Id),
  `trackUsage` (fire-and-forget usage logging after the response is sent). Zod
  validation lives in `utils/validate.ts`.
- **events/** — typed internal event bus (`eventBus.ts`).
- **observability/** — `metrics.ts` (Datadog custom metrics).
- **config/** — Zod-validated env vars (fail fast at boot if misconfigured).
- **utils/** — Pino logger, custom error classes + global error handler, hashing,
  `circuitBreaker.ts`, response builders.

> If asked "where does the AI happen?" the honest answer is: **almost all of it is in
> the Python service.** finbot-api orchestrates, caches, queues, and serves. That's a
> deliberate separation — Node for the I/O-bound API, Python for the ML/quant
> ecosystem (LiteLLM, yfinance, pandas-ta).

### Auth — two methods (know the difference)
- **JWT** for dashboard sessions: short-lived access token (15 min) +
  refresh token (7 days, HttpOnly cookie). Refresh tokens are **SHA-256 hashed**
  before storage and **rotated on every refresh**.
- **API keys** for programmatic access: prefixed (`fb_…`) for at-a-glance recognition,
  stored as **bcrypt hashes**, raw key shown **only once** at creation.

### Billing — provider abstraction + a subtle webhook detail
`billing.interface.ts` defines a provider contract; `billing.factory.ts` picks the
implementation; `providers/stripe.provider.ts` and `providers/paddle.provider.ts`
implement it. Stripe for cards, Paddle for international. Swapping/adding a provider
doesn't touch the billing service logic — **strategy pattern**.

**Worth mentioning unprompted (shows you've hit the real gotchas):** the billing
webhook route is mounted with `express.raw()` **before** the global `express.json()`.
HMAC signature verification needs the *raw request bytes* — `express.json()` would
parse the body into an object and destroy them, making every webhook fail
verification. Ordering of that one `app.post` line matters.

### Chat — a real RAG pipeline (nice feature to demo)
The `chat` module answers free-text market questions by **retrieving the project's own
data first**: it extracts the asset from the question, then in parallel
(`Promise.allSettled`) fetches the current sentiment score and semantically-searches
the last 24h of news for the ~5 most relevant articles, builds a grounded prompt, and
calls `complete()` (→ trading-agents → LiteLLM). Partial failures degrade gracefully —
no sentiment or no news still yields an answer. It's retrieval-augmented generation
over your own vector store + Postgres, not a raw LLM passthrough.

### Data model (Prisma / Postgres) — highlights
- `User` (with `plan` enum: FREE/STARTER/PRO/BUSINESS), `ApiKey`, `RefreshToken`.
- `SentimentScore` — one row per article, indexed on `(asset, createdAt)` because
  "BTC sentiment over the last 7 days" is the primary read pattern.
- `AnalysisResult` — full multi-agent output stored as `reports Json`, keyed by BullMQ `jobId`.
- `Webhook` — URL + event + threshold + HMAC secret; indexed on `(asset, event)`.
- `StockProfile` — Postgres acts as **L2 cache** under Redis L1; `updatedAt` drives
  TTL (refresh if older than 24h).

> Index choices are deliberate and follow the read patterns — call that out if asked
> about database performance.

---

## 6. news-scraper — Deep Dive

A **pipeline**, not a server. Two cron schedules (both configurable via env): the
**news pipeline every 2 hours** and the **pre-signals snapshot every 30 minutes**.
Both run once immediately on startup. Pipeline stages: `scraper/` → `pipeline/`
(normalize → embed → FinBERT score → upsert) → Pinecone, then **publish events to
RabbitMQ** for finbot-api to consume.

**FinBERT scoring detail (the "two-stage AI" first stage):** uses
**`ProsusAI/finbert`** via the HuggingFace Inference API — three class scores
(positive/negative/neutral) mapped to bullish/bearish/neutral plus a severity bucket
(≥0.85 high, ≥0.65 medium). It's throttled (~1 req / 1.6s) to stay under the HF free
tier — so the first full run takes ~16 min and incremental runs ~2 min. This is the
cheap, every-article pass; the expensive multi-agent LLM pass only runs on demand.

**Pre-signals pipeline** (the "trading edge" angle): every 30 min it pulls on-chain
(exchange flows, whale movements), derivatives (funding rate, open interest,
liquidations), social mention velocity, and macro context — signals that can move
*before* news breaks — using `Promise.allSettled` so one dead source doesn't sink the
snapshot. **Honest current state:** the snapshot is held **in-process in memory**
(`getLatestSnapshot()`); moving it to Redis so finbot-api can read it is a noted
next step, not done yet. Don't claim it's already wired to the API/SSE.

**Historical bootstrap** (`history/bootstrap.ts`, one-time): seeds Pinecone with
historical articles matched to yfinance price moves at +1d/+7d/+30d, so the signal
engine has useful "similar past events" data from day one rather than starting cold.

**Honest attribution note:** the RSS source list, dedupe logic, and data-source
adapters were adapted from the open-source `free-crypto-news` project (MIT). The
embedding, FinBERT scoring, vector storage, and signal logic are original. Being
upfront about what you built vs. adapted is a credibility signal in interviews.

---

## 7. trading-agents — Deep Dive

Python / FastAPI microservice, **internal-only** (auth via `X-Internal-Key`). It does
two distinct jobs, and it's worth separating them:

**1. The market-data / quant layer (`src/`, FastAPI routers).** Most of this service
isn't agents at all — it's a clean data API that finbot-api leans on:
- `routers/llm.py` → `/llm/complete` — generic LLM completion behind **LiteLLM**, with
  a **Groq → Gemini → OpenAI → Anthropic fallback chain**.
- `routers/data.py` → `/data/asset-type`, `/data/fundamentals`, `/data/onchain`,
  `/data/insiders`, `/data/price-history`, `/data/economic` (FRED macro: fed rate, CPI,
  unemployment, GDP — with a `degraded` flag when sources are partially down).
- `routers/indicators.py` → `/indicators/` — RSI, MACD, Bollinger, EMA, ATR, VWAP via
  yfinance + pandas-ta.
- `routers/analysis.py` → `/analyze/` — the full multi-agent run.
- Backing modules: `yf_client.py`, `indicators.py`, `fundamentals.py`, `onchain.py`,
  `insiders.py`, `economic.py`, `price_history.py`, `asset_type.py`, `llm.py`.

**2. The multi-agent analysis layer (`vendor/TradingAgents`, vendored MIT).** The
`/analyze/` endpoint drives the open-source TradingAgents framework. Analyst set is
chosen by finbot-api per asset: **`market`, `social`, `news`** for crypto, plus
**`fundamentals`** for stocks (skipped for crypto because P/E, EPS, balance sheet don't
exist for BTC — feeding them in just produces hallucinated noise). The framework then
runs a **bull vs. bear researcher debate** and a **risk manager** before emitting the
final BUY/SELL/HOLD + narrative reports (market/sentiment/news/fundamentals/investment_plan).

**A deliberate product decision worth mentioning:** the framework can emit direct
trade orders. We surface the analysis and decision narrative but frame it as
intelligence, not advice — financial-advice liability, regulatory risk, and LLM
reliability mean the human decides.

**Performance / reliability details:**
- `/analyze/` is slow (15–120s, occasionally up to ~10 min) — that's exactly why
  finbot-api only calls it from a **BullMQ worker**, never on the request path, and
  uses a custom undici agent to raise the client timeout to 11 minutes.
- Market data via **yfinance with retry + proxy support** — datacenter IPs get blocked
  by Yahoo, which was a real production bug (see recent commits).

---

## 8. Cross-Cutting Concerns (interviewers love these)

### Caching — two tiers
L1 in-process Map (fastest, per-instance) → L2 Redis (shared across instances) →
data store. Postgres even acts as an L2 cache for stock profiles under Redis.

### Rate limiting
Per-user **Redis sliding window**, limits driven by the user's plan tier. Lives in
middleware so every route gets it consistently.

### Resilience
- **Circuit breaker** (`utils/circuitBreaker.ts`) wraps **every** call to the
  trading-agents service (config: `failureThreshold: 5`, `probeInterval: 30s`) — after
  5 failures it opens and fails fast instead of piling requests onto a dying
  dependency, then probes to recover.
- **Per-call timeouts** via `AbortSignal.timeout` — e.g. 5s for asset-type, 15s for
  indicators/fundamentals, 30s for `/llm/complete`, 600s for `/analyze/`.
- **Async job queue** means a slow LLM never blocks the API.
- **Graceful degradation everywhere:** chat uses `Promise.allSettled` so a missing
  sentiment score or news fetch still returns an answer; webhook firing is wrapped in
  try/catch so delivery failures never fail the job; RabbitMQ publish is fire-and-forget.

### Messaging — RabbitMQ event flow (a strong, real talking point)
news-scraper publishes article events to a **durable `finbot.events` fanout exchange**;
finbot-api consumes them. The consumer is **at-least-once**: manual `ack` only after the
handler succeeds, `prefetch(1)` for back-pressure, `nack(requeue)` on handler failure,
and `nack(no-requeue)` for poison-pill (unparseable) messages so they don't loop
forever. (Production note I'd add: a dead-letter queue after N retries.)

### Real-time — SSE (not WebSocket)
The `stream` module pushes live updates over **Server-Sent Events** (`sse.ts`), fanned
out across instances via **Redis pub/sub**. SSE was the right call for one-directional
server→client push: simpler than WebSocket, works over plain HTTP, auto-reconnects.
Detail I'd mention: it sets `X-Accel-Buffering: no` so Nginx doesn't buffer events, and
sends heartbeat comments to survive proxy idle timeouts.

### Observability (Datadog)
APM traces (every HTTP request, DB query, Redis call, queue job traced end-to-end),
structured Pino JSON logs correlated to traces via `dd.trace_id`, and custom metrics
(`finbot.api.requests`, `finbot.sentiment.scored`, `finbot.queue.depth`).
**Detail to know:** `dd-trace` must be imported as the *very first line* in the entry
file so its monkey-patching works.

### Security (layered)
HTTPS + HSTS, Helmet headers (CSP, X-Frame-Options), bcrypt passwords, hashed API
keys, short JWTs, HttpOnly refresh cookies, per-user rate limiting, HMAC-SHA256 signed
webhook payloads, containers run **non-root** with `cap_drop: ALL`,
`no-new-privileges`, read-only filesystem, internal-only Docker network, SSH password
auth disabled + fail2ban. CI runs Gitleaks, Trivy, npm audit, pip-audit on every push.

---

## 9. DevOps & Infrastructure

- **Docker Compose** — local stack (postgres, redis, rabbitmq, the three app services);
  separate `docker-compose.prod.yml` for production.
- **Terraform** on **DigitalOcean** — IaC. Firewall opens only 22/80/443.
  `lifecycle { ignore_changes = [user_data] }` prevents accidental server recreation.
- **Nginx** — reverse proxy + SSL termination, Let's Encrypt auto-renew.
- **CI/CD (GitHub Actions):**
  - *CI (every PR):* `npm ci` → `prisma migrate deploy` (CI Postgres) → tests (real DB+Redis) → build.
  - *CD (merge to main):* build + push images to GHCR → SCP compose + nginx config → SSH `docker compose pull && up -d` → migrate prod.
  - *Security (push to main):* Gitleaks, npm audit, pip-audit, Trivy (HIGH/CRITICAL fails the build).

---

## 10. Testing Story

~139 tests across 16 test files. **Integration tests run against real Postgres and
Redis — no mocks.** Trade-off you should articulate: slower and needs infra, but
catches real bugs (connection handling, transaction behavior, actual query results,
cache semantics) that mocked tests silently miss. Unit tests cover pure logic
(cache, circuit breaker, hashing); integration tests cover routes and services.

---

## 11. Likely Interview Questions & How to Answer

**Q: Why a modular monolith instead of microservices?**
> Microservices add network calls, distributed transactions, and ops overhead I
> didn't need at this scale. The modular monolith gives me strict boundaries —
> modules only talk via the event bus or public `index.ts` — so I get the decoupling
> benefits and can extract a module into a service later if load demands it. I *did*
> split out trading-agents, because it's Python/ML and has a totally different scaling
> and dependency profile — that boundary earns its keep.

**Q: Why Pinecone / vector search instead of Postgres full-text search?**
> The core feature is *semantic* similarity — "find articles like this one" and "find
> past events similar to today's." Keyword search can't do that. Embeddings capture
> meaning, so "SEC sues exchange" matches "regulatory action against trading platform"
> even with no shared keywords. Postgres still holds the relational/transactional data.

**Q: How do you keep LLM costs under control?**
> Several levers. Cheap FinBERT pre-scoring runs at ingest in the scraper; the
> expensive multi-agent analysis only runs on demand and is gated behind the Pro tier.
> Results are persisted (`AnalysisResult`) and cached in Redis, and the BullMQ jobId is
> `analysis:{asset}:{date}` so identical requests dedup into one run instead of paying
> twice. LiteLLM gives a Groq→Gemini→OpenAI→Anthropic fallback chain, so cheap/fast
> providers are tried first.

**Q: How does the async analysis flow work / why not just await it?**
> The analysis call takes 15–120 seconds (sometimes minutes). Holding an HTTP
> connection open that long is fragile and burns resources. So I enqueue a BullMQ job,
> return a `jobId` immediately, a worker (concurrency 1) processes it, persists the
> result, and the client polls `/analysis/:jobId` or gets an `analysis_done` webhook.
> The jobId doubles as a dedup key.

**Q: What happens if Pinecone / the LLM / an external API goes down?**
> Circuit breaker + timeouts on every external call. The breaker opens after repeated
> failures so I fail fast instead of piling up requests. Cached data still serves
> reads, so the API degrades gracefully rather than going fully down.

**Q: How do you secure the internal Python service?**
> It's never exposed to the internet — only on the internal Docker network, only
> reachable from finbot-api, and it requires an `X-Internal-Key` header. Nginx is the
> single public entrypoint.

**Q: How do you handle secrets?**
> Env vars validated with Zod at boot (fail fast if missing). Gitleaks scans every
> push to catch accidental commits. Nothing sensitive in the repo; production secrets
> live on the server / in CI secrets.

**Q: API keys vs JWT — why both?**
> JWTs for interactive dashboard sessions (short-lived, refresh rotation, HttpOnly
> cookies). API keys for machine-to-machine — long-lived, bcrypt-hashed, prefixed,
> revocable. Different use cases, different lifetimes and storage.

**Q: Biggest challenge / what would you do differently?**
> Pick something real: e.g. datacenter IPs getting blocked by yfinance (solved with
> retry + proxy support — it's in the commit history), or tuning the parallel-vs-
> sequential agent execution to hit acceptable latency, or deciding to test against
> real infra instead of mocks. Honesty about a concrete trade-off beats a rehearsed
> "I'm a perfectionist."

**Q: You have RabbitMQ *and* BullMQ — why two messaging systems?**
> They solve different problems. RabbitMQ is the **cross-service event bus** —
> news-scraper publishes article events to a fanout exchange and finbot-api consumes
> them, decoupled and at-least-once. BullMQ is **in-process background jobs** for
> finbot-api itself (analysis, sentiment), backed by Redis, with retries, dedup by
> jobId, and concurrency control. One is inter-service pub/sub, the other is a job
> queue with worker semantics.

**Q: Real-time updates — WebSocket?**
> SSE, actually. The traffic is one-directional server→client (new articles, signal
> updates), so Server-Sent Events is simpler than WebSocket — plain HTTP, built-in
> auto-reconnect, no upgrade handshake. I fan out across API instances with Redis
> pub/sub, disable Nginx buffering with `X-Accel-Buffering: no`, and send heartbeats to
> beat proxy idle timeouts.

**Q: Why is so much logic in the Python service instead of Node?**
> Deliberate language-fit split. The API layer — auth, billing, routing, caching,
> queueing, lots of concurrent I/O — is Node's strength. The AI/quant layer — LiteLLM,
> the TradingAgents framework, yfinance, pandas-ta for indicators — lives in Python's
> ecosystem. finbot-api holds a single typed HTTP client to that service wrapped in a
> circuit breaker. It keeps each codebase idiomatic and lets the two scale separately.

**Q: How would you scale this to 100x traffic?**
> finbot-api is stateless, so scale it horizontally behind the load balancer — L2
> Redis cache and Redis-backed rate limiting already work across instances. Postgres
> gets read replicas (the read-client split already exists). BullMQ workers scale
> independently of the API. Pinecone and the LLM providers are managed/serverless.
> The async queue absorbs spikes. The first real bottleneck would be LLM cost/throughput,
> which I'd address with heavier caching and batching.

---

## 12. Things NOT to Oversell (be honest)

- The **dashboard** is not implemented — say "planned / open for collaboration."
- Parts of news-scraper (RSS source list, dedupe, data-source adapters) are **adapted
  from free-crypto-news (MIT)** — don't claim them as wholly original.
- trading-agents **vendors** the open-source TradingAgents framework — you wrapped it
  in a FastAPI service (plus your own market-data/indicator/LLM routers), you didn't
  invent the agent framework.
- Don't describe finbot-api as doing the AI itself — it **delegates** to the Python
  service. Saying "I built a thin orchestrator over a Python AI service" is both more
  accurate and a better architecture story than implying Node runs the models.
- The older `saas/SERVICES.md` describes things that aren't in the code (WebSocket
  server, separate OpenAI/Mistral/FinGPT clients, webhook/signal/email queue workers).
  Don't recite it — it predates the build.

Being precise about the boundary between what you built and what you integrated is a
green flag, not a weakness. The original work is: the API platform and its module
architecture, the two-stage AI pipeline design, the vector-search integration, the
RabbitMQ event bus + BullMQ job system, the SSE real-time layer, the
billing/auth/rate-limiting layer, and the whole production deployment.

---

## 13. 90-Second Closing Summary (if asked "tell me about a project")

> "FinBot is a financial-news intelligence API. The hardest and most interesting part
> was designing it as a pipeline of distinct concerns: a scheduled scraper that
> ingests and embeds news into a vector database, a TypeScript modular monolith that
> serves an authenticated, billed, rate-limited REST API, and an internal Python
> microservice that runs a multi-agent LLM debate to produce trading signals. I made
> deliberate trade-offs — two-stage AI to control cost, async job queues so slow LLM
> calls never block requests, a modular monolith for decoupling without distributed-
> systems overhead, and integration tests against real Postgres and Redis. It's fully
> containerized, deployed to DigitalOcean with Terraform, has a complete CI/CD and
> security-scanning pipeline, and is observable end-to-end with Datadog. I also made
> product calls, like deliberately not exposing direct buy/sell recommendations for
> liability reasons."

---

### Quick-reference cheat sheet

| Topic | One-line answer |
|---|---|
| Architecture | Modular monolith (Node) + Python AI/data microservice + cron pipeline, behind Nginx |
| Languages | TypeScript (Node 22), Python 3.13 |
| Datastores | Postgres 16, Redis 7, Pinecone (vectors) |
| Messaging | RabbitMQ (cross-service event bus, fanout) + BullMQ (in-process jobs) |
| Auth | JWT (dashboard, rotating refresh) + bcrypt-hashed API keys (programmatic) |
| AI | FinBERT pre-scoring (scraper) + multi-agent analysis + LLM completions via LiteLLM (Groq→Gemini→OpenAI→Anthropic) — all in the Python service |
| Where AI runs | finbot-api delegates to trading-agents over one HTTP client (circuit-breakered) |
| Async | BullMQ `analysis`/`sentiment` queues; jobId = dedup key; poll or webhook |
| Real-time | SSE + Redis pub/sub (not WebSocket) |
| Billing | Stripe + Paddle behind a provider interface (strategy pattern); raw-body webhook |
| Resilience | Circuit breaker (5 fails/30s probe), per-call timeouts, two-tier cache, graceful degradation |
| Deploy | Docker Compose, Terraform/DigitalOcean, GitHub Actions CI/CD |
| Observability | Datadog APM (dd-trace first import) + Pino structured logs + custom metrics |
| Tests | ~139, integration against real Postgres + Redis |
