import './tracer'; // must be first — patches node-cron, axios, amqplib before they load
import 'dotenv/config';
import cron from 'node-cron';
import pino from 'pino';
import { env } from './config/env';
import { runPipeline } from './pipeline/index';
import { runPreSignals } from './pre-signals/index';
import { connectPublisher, disconnectPublisher } from './shared/rabbitmq/rabbitmq.publisher';

const logger = pino({ transport: { target: 'pino-pretty', options: { colorize: true } } });

async function main() {
  logger.info('News scraper starting...');
  logger.info(`Environment: ${env.NODE_ENV}`);
  logger.info(`Cron schedule: ${env.SCRAPER_CRON_SCHEDULE}`);
  logger.info(`Pre-signals schedule: ${env.PRE_SIGNALS_CRON_SCHEDULE}`);

  // Connect RabbitMQ publisher before running the pipeline (non-fatal if unavailable)
  await connectPublisher();

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received — shutting down');
    await disconnectPublisher();
    process.exit(0);
  });

  // Run both immediately on startup
  runPipeline().catch(err => logger.error(err, 'Pipeline failed on startup'));
  runPreSignals().catch(err => logger.error(err, 'Pre-signals failed on startup'));

  // News pipeline — every 2 hours (default: '0 */2 * * *')
  cron.schedule(env.SCRAPER_CRON_SCHEDULE, () => {
    logger.info('Cron triggered — running pipeline');
    runPipeline().catch(err => logger.error(err, 'Pipeline failed on cron'));
  });

  // Pre-signals — every 30 minutes (market context changes faster than news)
  cron.schedule(env.PRE_SIGNALS_CRON_SCHEDULE, () => {
    logger.info('Cron triggered — running pre-signals');
    runPreSignals().catch(err => logger.error(err, 'Pre-signals failed on cron'));
  });
}

main().catch(err => {
  logger.error(err, 'Fatal startup error');
  process.exit(1);
});
