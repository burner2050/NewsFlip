# NewsFlip

A news aggregator built on **PostgreSQL + TypeScript/Node.js**. It ingests RSS/Atom
feeds, deduplicates articles, stores them in Postgres with full-text search, and
serves a simple server-rendered UI with search and alerts.

The AI-heavy features (semantic embeddings, story clustering, fact extraction,
LLM summaries) are designed in but **stubbed** behind pluggable interfaces so the
whole pipeline runs today with no external API keys. Phase 2 swaps real
providers in without touching call sites.

## Architecture

```
RSS/Atom ──▶ fetch (conditional GET) ──▶ parse ──▶ normalize ──▶ dedup ──▶ Postgres
                                                                  │
              exact: canonical-URL + SHA-256 content hash ────────┤
              near : 64-bit SimHash (Hamming distance)  ──────────┘

Postgres ──▶ Full-text search (tsvector + websearch_to_tsquery)
         ──▶ Alerts (saved searches matched on ingest)
         ──▶ Web UI (Fastify + EJS + HTMX)

Phase 2 (interfaces ready): pgvector embeddings ▶ story clustering ▶ fact
extraction ▶ summaries.
```

### Tech
- **Postgres 16 + pgvector + pg_trgm** — storage, FTS, (future) vector search
- **TypeScript / Node 20+** (ESM)
- **Fastify + @fastify/view (EJS) + HTMX** — server-rendered UI, live search
- **rss-parser + undici** — feed fetching/parsing with ETag/Last-Modified caching
- **node-cron** — scheduled ingestion

## Layout
```
db/migrations/        SQL migrations (001_init.sql)
src/
  config.ts           env-driven config
  db/                 pool, migrate runner, repos (sources, articles)
  lib/                logger, url canonicalization, hashing/simhash, text utils
  ai/                 pluggable Embedder / FactExtractor / Summarizer (+ stubs)
  ingest/             rss fetch, dedup, ingest orchestrator
  search/             full-text search
  alerts/             saved-search matching
  web/                Fastify server + EJS/HTMX views
  worker.ts           cron scheduler
  cli.ts              admin CLI
```

## Quick start

1. **Start Postgres** (with pgvector):
   ```bash
   docker compose up -d
   ```

2. **Install + configure**:
   ```bash
   npm install
   cp .env.example .env      # defaults match docker-compose
   ```

3. **Migrate, seed feeds, ingest**:
   ```bash
   npm run migrate
   npm run cli -- seed
   npm run cli -- ingest
   ```

4. **Run the UI**:
   ```bash
   npm run dev               # http://localhost:3000
   ```

5. **Run the scheduler** (separate terminal) to poll feeds on a cron:
   ```bash
   npm run worker
   ```

## CLI

```bash
npm run cli -- help
npm run cli -- add-feed "My Feed" https://example.com/rss.xml https://example.com
npm run cli -- list-feeds
npm run cli -- ingest
npm run cli -- search "interest rates" OR inflation
npm run cli -- add-alert "Rates" '"interest rates" OR inflation'
npm run cli -- run-alerts
```

## Search syntax
Uses Postgres `websearch_to_tsquery`: quoted `"phrases"`, `OR`, and `-negation`.

## Deduplication
- **Exact**: canonical URL (tracking params stripped) is `UNIQUE`; plus a SHA-256
  hash of normalized title+body catches the same story syndicated under new URLs.
- **Near**: a 64-bit SimHash over token + bigram shingles. Articles within
  `DEDUP_HAMMING_THRESHOLD` bits of a recent article (within
  `DEDUP_WINDOW_HOURS`) are treated as duplicates.

## Configuration
See `.env.example`. Key vars: `DATABASE_URL`, `PORT`, `INGEST_CRON`,
`DEDUP_HAMMING_THRESHOLD`, `DEDUP_WINDOW_HOURS`, `AI_PROVIDER`,
`EMBEDDING_PROVIDER`, `EMBEDDING_DIM`.

## License & open-core model

NewsFlip is **open-core**:

- The **core** (everything outside `ee/`) is licensed under **AGPL-3.0** — see
  [`LICENSE`](./LICENSE). If you run a modified version as a network service, the
  AGPL requires you to offer your source changes to its users.
- **Premium features** live in [`ee/`](./ee/) under a separate **commercial
  license** ([`ee/LICENSE`](./ee/LICENSE)) and activate only with a valid
  `NEWSFLIP_LICENSE_KEY`.

Core never imports `ee/`; premium implementations plug in behind the interfaces
in `src/ai/types.ts` and the license gate in `src/license/license.ts`, so the
project builds and runs fully on the AGPL core alone. Commercial licensing:
contact@devteam.ro.

## Story clustering (implemented)
Articles are grouped into **stories** so the same event covered by N outlets
shows as one entry:

- Each article gets an embedding (pluggable; currently the lexical stub
  embedder — swap in a real model via `EMBEDDING_PROVIDER`).
- **Single-link clustering**: a new article joins the story of its most similar
  already-clustered article (via pgvector `<=>` cosine, HNSW index) when the
  similarity is `>= CLUSTER_SIM_THRESHOLD`, within `CLUSTER_WINDOW_HOURS`.
  Matching against members (not a drifting centroid) avoids "rich-get-richer"
  collapse.
- The homepage shows **Top Stories**; each `/story/:id` page shows the source
  coverage and a timeline.

```bash
npm run cli -- cluster        # embed + cluster unassigned articles
npm run cli -- list-stories   # see clustered stories
npm run cli -- recluster      # wipe stories and re-cluster (keeps embeddings)
npm run cli -- reembed        # recompute all embeddings (after changing embedder)
```

> Cluster quality scales with the embedder. The stub is lexical (shared
> vocabulary), so it groups same-event articles well but can over-group
> same-source listicles. Real semantic embeddings fix that with no code change.

## Phase 2 (remaining, interfaces in place)
- Real embeddings (`EMBEDDING_PROVIDER=anthropic|openai|ollama`) → better
  clusters automatically.
- **Fact extraction** (who/what/when/numbers/quotes/companies/tickers…) +
  grounded **summaries** via `AI_PROVIDER` implementing the `FactExtractor` /
  `Summarizer` interfaces — rendered on the story page.
- Alert delivery via webhook/email (schema already supports channels).
