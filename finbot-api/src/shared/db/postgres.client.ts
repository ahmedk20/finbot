import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL']! });

const prisma = new PrismaClient({
  adapter,
  log: [
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

prisma.$on('warn', e => logger.warn(e, 'Prisma warning'));
prisma.$on('error', e => logger.error(e, 'Prisma error'));

export { prisma };
