/**
 * Three-layer caching strategy for stock data:
 *
 *   L1  — in-process Map (l1.cache.ts)  — 5 min TTL  — zero-latency, single-process only
 *   L2  — Redis (l2.cache.ts)           — 6 h  TTL  — shared across instances
 *   L3  — Postgres (Prisma)             — 24 h TTL  — survives restarts, drives background refresh
 *
 * Read path: L1 → L2 → L3 → (miss = caller fetches live then calls upsert*)
 * Write path: upsert* always writes L3; populates L2 and L1 on the way out.
 *
 * Why 24h for Postgres?  FMP profiles update daily.  Price data is fresher — callers
 * that want live price always hit /price/snapshot directly via getPolySnapshot().
 */

import { prisma } from '../../shared/db/postgres.client';
import { Prisma } from '@prisma/client';
import { l1 }    from '../../shared/cache/l1.cache';
import * as l2   from '../../shared/cache/l2.cache';
import type { StockProfileRecord } from './stock.types';

// Prisma Json fields require InputJsonValue — use this helper to safely cast
function toJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

const PROFILE_L1_TTL_MS  = 5  * 60 * 1_000;   // 5 minutes
const PROFILE_L2_TTL_SEC = 6  * 3600;           // 6 hours
const PROFILE_DB_TTL_MS  = 24 * 3600 * 1_000;  // 24 hours

function profileKey(ticker: string) { return `stock:profile:${ticker}`; }

// ── Profile ───────────────────────────────────────────────────────────────────

export async function getProfile(ticker: string): Promise<StockProfileRecord | null> {
  const key = profileKey(ticker);

  // L1
  const l1Hit = l1.get<StockProfileRecord>(key);
  if (l1Hit) return l1Hit;

  // L2
  const l2Hit = await l2.get<StockProfileRecord>(key);
  if (l2Hit) {
    l1.set(key, l2Hit, PROFILE_L1_TTL_MS);
    return l2Hit;
  }

  // L3
  const row = await prisma.stockProfile.findUnique({ where: { ticker } });
  if (!row) return null;

  const record = row as unknown as StockProfileRecord;
  l1.set(key, record, PROFILE_L1_TTL_MS);
  await l2.set(key, record, PROFILE_L2_TTL_SEC);
  return record;
}

export function isProfileStale(record: StockProfileRecord): boolean {
  return Date.now() - record.updatedAt.getTime() > PROFILE_DB_TTL_MS;
}

export async function upsertProfile(
  ticker: string,
  data: Omit<StockProfileRecord, 'id' | 'ticker' | 'createdAt' | 'updatedAt'>,
): Promise<StockProfileRecord> {
  const row = await prisma.stockProfile.upsert({
    where:  { ticker },
    update: data,
    create: { ticker, ...data },
  });

  const record = row as unknown as StockProfileRecord;
  const key    = profileKey(ticker);
  l1.set(key, record, PROFILE_L1_TTL_MS);
  await l2.set(key, record, PROFILE_L2_TTL_SEC);
  return record;
}

export async function updateAiSummary(ticker: string, summary: string): Promise<void> {
  await prisma.stockProfile.update({
    where:  { ticker },
    data:   { aiSummary: summary, aiSummaryAt: new Date() },
  });

  // Invalidate caches so next read reflects the new summary
  const key = profileKey(ticker);
  l1.delete(key);
  await l2.del(key);
}

// ── Financials ────────────────────────────────────────────────────────────────

const FIN_L2_TTL_SEC = 24 * 3600;  // financials update quarterly — 24h is fine

function finKey(ticker: string) { return `stock:financials:${ticker}`; }

export async function getFinancials(ticker: string): Promise<unknown | null> {
  const key = finKey(ticker);

  const l2Hit = await l2.get<unknown>(key);
  if (l2Hit) return l2Hit;

  const row = await prisma.stockFinancials.findUnique({ where: { ticker } });
  if (!row) return null;

  await l2.set(key, row, FIN_L2_TTL_SEC);
  return row;
}

export async function upsertFinancials(ticker: string, period: string, data: {
  incomeStatement: unknown; balanceSheet: unknown; cashFlow: unknown;
}): Promise<void> {
  await prisma.stockFinancials.upsert({
    where:  { ticker },
    update: { period, incomeStatement: toJson(data.incomeStatement), balanceSheet: toJson(data.balanceSheet), cashFlow: toJson(data.cashFlow) },
    create: { ticker, period, incomeStatement: toJson(data.incomeStatement), balanceSheet: toJson(data.balanceSheet), cashFlow: toJson(data.cashFlow) },
  });
  await l2.del(finKey(ticker));
}

// ── Analysts ──────────────────────────────────────────────────────────────────

const ANA_L2_TTL_SEC = 6 * 3600;

function anaKey(ticker: string) { return `stock:analysts:${ticker}`; }

export async function getAnalysts(ticker: string): Promise<unknown | null> {
  const key = anaKey(ticker);

  const l2Hit = await l2.get<unknown>(key);
  if (l2Hit) return l2Hit;

  const row = await prisma.stockAnalysts.findUnique({ where: { ticker } });
  if (!row) return null;

  await l2.set(key, row, ANA_L2_TTL_SEC);
  return row;
}

export async function upsertAnalysts(ticker: string, data: {
  grades: unknown; priceTargetConsensus: unknown;
}): Promise<void> {
  await prisma.stockAnalysts.upsert({
    where:  { ticker },
    update: { grades: toJson(data.grades), priceTargetConsensus: toJson(data.priceTargetConsensus) },
    create: { ticker, grades: toJson(data.grades), priceTargetConsensus: toJson(data.priceTargetConsensus) },
  });
  await l2.del(anaKey(ticker));
}

// ── Ownership ─────────────────────────────────────────────────────────────────

const OWN_L2_TTL_SEC = 24 * 3600;  // 13F filings are quarterly

function ownKey(ticker: string) { return `stock:ownership:${ticker}`; }

export async function getOwnership(ticker: string): Promise<unknown | null> {
  const key = ownKey(ticker);

  const l2Hit = await l2.get<unknown>(key);
  if (l2Hit) return l2Hit;

  const row = await prisma.stockOwnership.findUnique({ where: { ticker } });
  if (!row) return null;

  await l2.set(key, row, OWN_L2_TTL_SEC);
  return row;
}

export async function upsertOwnership(ticker: string, data: {
  institutional: unknown; etfs: unknown;
}): Promise<void> {
  await prisma.stockOwnership.upsert({
    where:  { ticker },
    update: { institutional: toJson(data.institutional), etfs: toJson(data.etfs) },
    create: { ticker, institutional: toJson(data.institutional), etfs: toJson(data.etfs) },
  });
  await l2.del(ownKey(ticker));
}
