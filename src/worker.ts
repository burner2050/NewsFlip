import cron from 'node-cron';
import { config } from './config.js';
import { log } from './lib/logger.js';
import { pool } from './db/pool.js';
import { ingestAll } from './ingest/ingest.js';
import { runAlerts } from './alerts/alerts.js';

let running = false;

async function tick(): Promise<void> {
  if (running) {
    log.warn('Previous ingest cycle still running, skipping this tick');
    return;
  }
  running = true;
  try {
    await ingestAll();
    await runAlerts(config.dedupWindowHours);
  } catch (err) {
    log.error('Ingest cycle failed', err);
  } finally {
    running = false;
  }
}

async function main(): Promise<void> {
  if (!cron.validate(config.ingestCron)) {
    log.error(`Invalid INGEST_CRON: "${config.ingestCron}"`);
    process.exit(1);
  }

  log.info(`Worker started. Schedule: "${config.ingestCron}". Running an initial cycle now…`);
  await tick();

  const task = cron.schedule(config.ingestCron, tick);

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      log.info(`${sig} received, stopping worker`);
      task.stop();
      pool.end().finally(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  log.error('Worker failed to start', err);
  pool.end().finally(() => process.exit(1));
});
