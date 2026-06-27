-- NewsFlip initial schema
-- Requires the pgvector extension (provided by the pgvector/pgvector image).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Sources: one row per RSS/Atom feed we poll.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            TEXT        NOT NULL,
  feed_url        TEXT        NOT NULL UNIQUE,
  site_url        TEXT,
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  -- HTTP conditional-get caching hints
  etag            TEXT,
  last_modified   TEXT,
  last_fetched_at TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Stories: a cluster of articles about the same event (populated in phase 2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stories (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title         TEXT,
  summary       TEXT,
  centroid      vector(384),
  article_count INTEGER     NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Articles: deduplicated, normalized items extracted from feeds.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS articles (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id      BIGINT      NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  story_id       BIGINT      REFERENCES stories(id) ON DELETE SET NULL,
  guid           TEXT,                       -- feed-provided id, may be null
  url            TEXT        NOT NULL,
  canonical_url  TEXT        NOT NULL,       -- normalized for dedup
  title          TEXT        NOT NULL,
  author         TEXT,
  content        TEXT        NOT NULL DEFAULT '',
  excerpt        TEXT,
  lang           TEXT,
  published_at   TIMESTAMPTZ,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash   TEXT        NOT NULL,       -- sha256 of normalized text (exact dup)
  simhash        BIGINT      NOT NULL,       -- 64-bit simhash (near dup)
  embedding      vector(384),                -- filled in phase 2
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- generated full-text search vector: title weighted higher than body
  search_tsv     tsvector GENERATED ALWAYS AS (
                   setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                   setweight(to_tsvector('english', coalesce(content, '')), 'B')
                 ) STORED,
  CONSTRAINT articles_canonical_url_key UNIQUE (canonical_url)
);

CREATE UNIQUE INDEX IF NOT EXISTS articles_source_guid_uniq
  ON articles (source_id, guid) WHERE guid IS NOT NULL;
CREATE INDEX IF NOT EXISTS articles_search_tsv_idx ON articles USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS articles_published_at_idx ON articles (published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS articles_story_id_idx ON articles (story_id);
CREATE INDEX IF NOT EXISTS articles_content_hash_idx ON articles (content_hash);
CREATE INDEX IF NOT EXISTS articles_title_trgm_idx ON articles USING GIN (title gin_trgm_ops);
-- ANN index for embedding similarity (phase 2 clustering / related stories)
CREATE INDEX IF NOT EXISTS articles_embedding_idx
  ON articles USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Facts: structured claims extracted from articles (phase 2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  article_id  BIGINT      NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  subject     TEXT        NOT NULL,
  predicate   TEXT        NOT NULL,
  object      TEXT        NOT NULL,
  confidence  REAL        NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facts_article_id_idx ON facts (article_id);

-- ---------------------------------------------------------------------------
-- Alerts: saved searches that match incoming articles.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT        NOT NULL,
  query       TEXT        NOT NULL,          -- websearch_to_tsquery syntax
  channel     TEXT        NOT NULL DEFAULT 'inbox', -- inbox | webhook | email
  target      TEXT,                          -- webhook url / email address
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_matches (
  alert_id   BIGINT      NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  article_id BIGINT      NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified   BOOLEAN     NOT NULL DEFAULT FALSE,
  PRIMARY KEY (alert_id, article_id)
);
CREATE INDEX IF NOT EXISTS alert_matches_unnotified_idx
  ON alert_matches (alert_id) WHERE notified = FALSE;
