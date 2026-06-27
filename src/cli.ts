import { pool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { addSource, listSources } from './db/sources.js';
import { ingestAll } from './ingest/ingest.js';
import { searchArticles } from './search/search.js';
import { addAlert, listAlerts, runAlerts } from './alerts/alerts.js';
import { backfillEmbeddings, clusterUnassigned, recluster, reembedAll } from './cluster/cluster.js';
import { listStories } from './db/stories.js';
import { log } from './lib/logger.js';

const HELP = `NewsFlip CLI

Usage: npm run cli -- <command> [args]

Commands:
  migrate                         Apply pending DB migrations
  add-feed <name> <feedUrl> [siteUrl]
                                  Register an RSS/Atom feed
  list-feeds                      List registered feeds
  seed                            Add a few well-known sample feeds
  ingest                          Fetch all feeds now (dedup + persist + cluster)
  backfill-embeddings             Embed any articles missing an embedding
  cluster                         Embed + cluster unassigned articles into stories
  recluster                       Wipe stories and re-cluster everything
  list-stories                    List clustered stories (largest first)
  search <query...>               Full-text search articles
  add-alert <name> <query...>     Create a saved-search alert
  list-alerts                     List alerts
  run-alerts                      Match recent articles against alerts
  help                            Show this help
`;

const SAMPLE_FEEDS: [string, string, string][] = [
  ['BBC News - World', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'https://www.bbc.com/news'],
  ['NPR News', 'https://feeds.npr.org/1001/rss.xml', 'https://www.npr.org'],
  ['The Guardian - World', 'https://www.theguardian.com/world/rss', 'https://www.theguardian.com/world'],
  ['The Verge', 'https://www.theverge.com/rss/index.xml', 'https://www.theverge.com'],
  ['Hacker News Front Page', 'https://hnrss.org/frontpage', 'https://news.ycombinator.com'],
];

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case 'migrate':
      await migrate();
      break;

    case 'add-feed': {
      const [name, feedUrl, siteUrl] = args;
      if (!name || !feedUrl) throw new Error('Usage: add-feed <name> <feedUrl> [siteUrl]');
      const s = await addSource(name, feedUrl, siteUrl);
      log.info(`Added feed #${s.id}: ${s.name}`);
      break;
    }

    case 'list-feeds': {
      const sources = await listSources();
      if (sources.length === 0) log.info('No feeds registered. Try `npm run cli -- seed`.');
      for (const s of sources) {
        const status = s.last_error ? `ERROR: ${s.last_error}` : s.last_fetched_at ? `last ${s.last_fetched_at.toISOString()}` : 'never fetched';
        log.info(`#${s.id} ${s.active ? '✓' : '✗'} ${s.name} — ${s.feed_url} (${status})`);
      }
      break;
    }

    case 'seed': {
      for (const [name, feedUrl, siteUrl] of SAMPLE_FEEDS) {
        const s = await addSource(name, feedUrl, siteUrl);
        log.info(`Seeded #${s.id}: ${s.name}`);
      }
      break;
    }

    case 'ingest': {
      const stats = await ingestAll();
      log.info(`Inserted ${stats.inserted}, duplicates ${stats.duplicates}, errors ${stats.errors}`);
      break;
    }

    case 'backfill-embeddings': {
      const n = await backfillEmbeddings();
      log.info(`Embedded ${n} article(s)`);
      break;
    }

    case 'cluster': {
      const n = await backfillEmbeddings();
      const { created, joined } = await clusterUnassigned();
      log.info(`Embedded ${n}; ${created} new story(ies), ${joined} joined`);
      break;
    }

    case 'recluster': {
      const { created, joined } = await recluster();
      log.info(`Reclustered: ${created} story(ies), ${joined} article(s) joined`);
      break;
    }

    case 'reembed': {
      const n = await reembedAll();
      log.info(`Re-embedded ${n} article(s) (stories detached; run \`cluster\` next)`);
      break;
    }

    case 'list-stories': {
      const stories = await listStories(40);
      if (stories.length === 0) log.info('No stories yet. Run `npm run cli -- cluster`.');
      for (const s of stories) {
        log.info(`#${s.id} [${s.article_count} articles / ${s.source_count} sources] ${s.title ?? '(untitled)'}`);
      }
      break;
    }

    case 'search': {
      const q = args.join(' ');
      if (!q) throw new Error('Usage: search <query...>');
      const { hits, total } = await searchArticles(q, 20);
      log.info(`${total} result(s) for "${q}":`);
      for (const h of hits) {
        log.info(`  [${h.rank.toFixed(3)}] ${h.title} — ${h.source_name}`);
      }
      break;
    }

    case 'add-alert': {
      const [name, ...rest] = args;
      const q = rest.join(' ');
      if (!name || !q) throw new Error('Usage: add-alert <name> <query...>');
      const a = await addAlert(name, q);
      log.info(`Added alert #${a.id}: ${a.name} → "${a.query}"`);
      break;
    }

    case 'list-alerts': {
      const alerts = await listAlerts();
      for (const a of alerts) log.info(`#${a.id} ${a.active ? '✓' : '✗'} ${a.name} → "${a.query}" [${a.channel}]`);
      break;
    }

    case 'run-alerts': {
      const n = await runAlerts(24);
      log.info(`${n} new alert match(es)`);
      break;
    }

    case 'help':
    case undefined:
      console.log(HELP);
      break;

    default:
      console.log(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main()
  .then(() => pool.end())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    log.error('CLI error', err instanceof Error ? err.message : err);
    pool.end().finally(() => process.exit(1));
  });
