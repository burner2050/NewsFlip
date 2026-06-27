import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify from 'fastify';
import view from '@fastify/view';
import formbody from '@fastify/formbody';
import ejs from 'ejs';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { pool } from '../db/pool.js';
import { listRecent, getArticle, countArticles } from '../db/articles.js';
import { listStories, getStory, getStoryArticles, countStories } from '../db/stories.js';
import { listSources } from '../db/sources.js';
import { searchArticles, normalizeQuery } from '../search/search.js';
import { listAlerts, addAlert, listAlertMatches } from '../alerts/alerts.js';

const VIEWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'views');

export function buildServer() {
  const app = Fastify({ logger: false });

  app.register(formbody);
  app.register(view, {
    engine: { ejs },
    root: VIEWS_DIR,
    layout: 'layout.ejs',
    defaultContext: { active: '' },
  });

  // Home: clustered stories (falls back to the raw article list if nothing has
  // been clustered yet).
  app.get('/', async (req, reply) => {
    const page = Math.max(1, Number((req.query as any).page) || 1);
    const pageSize = 30;
    const total = await countStories();
    if (total === 0) {
      const [articles, articleTotal] = await Promise.all([
        listRecent(pageSize, (page - 1) * pageSize),
        countArticles(),
      ]);
      return reply.view('index.ejs', {
        title: 'Latest', active: 'home', articles, page, pageSize, total: articleTotal,
      });
    }
    const stories = await listStories(pageSize, (page - 1) * pageSize);
    return reply.view('stories.ejs', {
      title: 'Top Stories', active: 'home', stories, page, pageSize, total,
    });
  });

  // Story detail: clustered coverage from multiple sources
  app.get('/story/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const story = Number.isFinite(id) ? await getStory(id) : null;
    if (!story) {
      return reply.code(404).view('error.ejs', { title: 'Not found', active: '', message: 'Story not found.' });
    }
    const articles = await getStoryArticles(id);
    const sources = [...new Set(articles.map((a) => a.source_name))];
    return reply.view('story.ejs', { title: story.title ?? 'Story', active: 'home', story, articles, sources });
  });

  // Search (full page + HTMX partial when ?partial=1)
  app.get('/search', async (req, reply) => {
    const q = normalizeQuery(String((req.query as any).q ?? ''));
    const partial = (req.query as any).partial === '1';
    const result = q ? await searchArticles(q, 30) : { hits: [], total: 0 };
    const data = { title: q ? `Search: ${q}` : 'Search', active: 'search', q, result };
    if (partial) {
      return reply.view('_results.ejs', data, { layout: false as any });
    }
    return reply.view('search.ejs', data);
  });

  // Article detail
  app.get('/article/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const article = Number.isFinite(id) ? await getArticle(id) : null;
    if (!article) {
      return reply.code(404).view('error.ejs', { title: 'Not found', active: '', message: 'Article not found.' });
    }
    return reply.view('article.ejs', { title: article.title, active: '', article });
  });

  // Sources
  app.get('/sources', async (_req, reply) => {
    const sources = await listSources();
    return reply.view('sources.ejs', { title: 'Sources', active: 'sources', sources });
  });

  // Alerts list + matches
  app.get('/alerts', async (_req, reply) => {
    const alerts = await listAlerts();
    const withMatches = await Promise.all(
      alerts.map(async (a) => ({ alert: a, matches: await listAlertMatches(a.id, 10) })),
    );
    return reply.view('alerts.ejs', { title: 'Alerts', active: 'alerts', items: withMatches });
  });

  app.post('/alerts', async (req, reply) => {
    const body = req.body as { name?: string; query?: string };
    if (body.name && body.query) {
      await addAlert(body.name.trim(), body.query.trim());
    }
    return reply.redirect('/alerts');
  });

  app.get('/healthz', async () => ({ ok: true }));

  return app;
}

async function start(): Promise<void> {
  const app = buildServer();
  try {
    await app.listen({ host: config.host, port: config.port });
    log.info(`NewsFlip web listening on http://${config.host}:${config.port}`);
  } catch (err) {
    log.error('Failed to start server', err);
    await pool.end();
    process.exit(1);
  }

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      log.info(`${sig} received, shutting down`);
      app.close().then(() => pool.end()).finally(() => process.exit(0));
    });
  }
}

// Start when run directly (not when imported by tests).
if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1])) {
  start();
}
