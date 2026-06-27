import 'dotenv/config';

function str(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

function int(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = str('PGUSER', 'newsflip');
  const pass = str('PGPASSWORD', 'newsflip');
  const host = str('PGHOST', 'localhost');
  const port = str('PGPORT', '5432');
  const db = str('PGDATABASE', 'newsflip');
  return `postgres://${user}:${pass}@${host}:${port}/${db}`;
}

export const config = {
  databaseUrl: databaseUrl(),
  host: str('HOST', '0.0.0.0'),
  port: int('PORT', 3000),

  ingestCron: str('INGEST_CRON', '*/15 * * * *'),
  fetchTimeoutMs: int('FETCH_TIMEOUT_MS', 15000),
  dedupHammingThreshold: int('DEDUP_HAMMING_THRESHOLD', 3),
  dedupWindowHours: int('DEDUP_WINDOW_HOURS', 72),

  aiProvider: str('AI_PROVIDER', 'stub'),
  embeddingProvider: str('EMBEDDING_PROVIDER', 'stub'),
  embeddingDim: int('EMBEDDING_DIM', 384),

  logLevel: str('LOG_LEVEL', 'info'),
} as const;

export type Config = typeof config;
