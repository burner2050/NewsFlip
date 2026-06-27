import { query } from '../db/pool.js';
import { log } from '../lib/logger.js';
import type { ArticleWithSource } from '../db/articles.js';

export interface Alert {
  id: number;
  name: string;
  query: string;
  channel: string;
  target: string | null;
  active: boolean;
  last_run_at: Date | null;
  created_at: Date;
}

export async function addAlert(name: string, q: string, channel = 'inbox', target?: string): Promise<Alert> {
  const { rows } = await query<Alert>(
    `INSERT INTO alerts (name, query, channel, target) VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, q, channel, target ?? null],
  );
  return rows[0]!;
}

export async function listAlerts(): Promise<Alert[]> {
  const { rows } = await query<Alert>('SELECT * FROM alerts ORDER BY created_at DESC');
  return rows;
}

/**
 * Match recently-fetched articles against every active alert and record hits in
 * alert_matches. Idempotent: the (alert_id, article_id) PK + ON CONFLICT means
 * re-running won't create duplicate matches. Returns the number of new matches.
 *
 * Phase 2: dispatch webhook/email for unnotified matches; for now 'inbox'
 * matches are simply browsable in the UI.
 */
export async function runAlerts(sinceHours = 1): Promise<number> {
  const alerts = await listAlerts();
  let newMatches = 0;

  for (const alert of alerts) {
    if (!alert.active) continue;
    const { rowCount } = await query(
      `INSERT INTO alert_matches (alert_id, article_id)
       SELECT $1, a.id
         FROM articles a
        WHERE a.fetched_at > now() - ($2 || ' hours')::interval
          AND a.search_tsv @@ websearch_to_tsquery('english', $3)
       ON CONFLICT (alert_id, article_id) DO NOTHING`,
      [alert.id, sinceHours, alert.query],
    );
    newMatches += rowCount ?? 0;
    await query('UPDATE alerts SET last_run_at = now() WHERE id = $1', [alert.id]);
  }

  if (newMatches > 0) log.info(`Alerts: ${newMatches} new match(es)`);
  return newMatches;
}

export interface AlertMatch extends ArticleWithSource {
  matched_at: Date;
}

export async function listAlertMatches(alertId: number, limit = 50): Promise<AlertMatch[]> {
  const { rows } = await query<AlertMatch>(
    `SELECT a.*, s.name AS source_name, s.site_url, m.matched_at
       FROM alert_matches m
       JOIN articles a ON a.id = m.article_id
       JOIN sources s ON s.id = a.source_id
      WHERE m.alert_id = $1
      ORDER BY m.matched_at DESC
      LIMIT $2`,
    [alertId, limit],
  );
  return rows;
}
