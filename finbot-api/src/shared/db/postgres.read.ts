// Read replica client.
// Phase 6: point READ_DATABASE_URL to a replica and instantiate a separate PrismaClient here.
// Until then, re-export the write client — Railway starter has one DB instance.
export { prisma as prismaRead } from './postgres.client';
