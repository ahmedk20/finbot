import './tracer'; // must be first — patches Express, pg, ioredis, BullMQ before they load
import 'dotenv/config';
import { app } from './app';
import { env } from './shared/config/env';
import { logger } from './shared/utils/logger';
import { setupRabbitMQ } from './shared/rabbitmq/rabbitmq.setup';
import { disconnect } from './shared/rabbitmq/rabbitmq.client';

const server = app.listen(env.PORT, async () => {
  logger.info(`FinBot API started on port ${env.PORT}`);
  logger.info(`Environment: ${env.NODE_ENV}`);

  // Connect to RabbitMQ and start consuming events (non-fatal if unavailable)
  await setupRabbitMQ();
});

// Graceful shutdown — drain in-flight messages before closing connection
process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down gracefully');
  server.close(async () => {
    await disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 30_000);
});
