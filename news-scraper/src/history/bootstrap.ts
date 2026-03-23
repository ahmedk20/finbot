/**
 * Historical article bootstrap — Day 12-14
 *
 * Streams all 102 JSONL files from the free-crypto-news archive (662k articles,
 * 2017-2025), normalizes each article, embeds via HuggingFace, and upserts to
 * Pinecone's `finbot-history` namespace.
 *
 * Run once:
 *   npx tsx src/history/bootstrap.ts
 *
 * Key design choices:
 *  - Skips FinBERT — archive already has sentiment.label + confidence.
 *    This saves ~18 hours of throttled API calls (662k × 1.6s).
 *  - Streams JSONL line-by-line — never loads a full file into RAM.
 *  - Processes in chunks of CHUNK_SIZE articles — embeds → upserts → next chunk.
 *  - Upserts to `finbot-history` namespace (separate from live data).
 *  - Idempotent: re-running re-upserts the same Pinecone IDs (safe).
 *  - Skips articles with no valid title (meta.has_valid_title = false).
 *
 * Pinecone namespace plan:
 *  finbot-history  → archive articles (this script)
 *  finbot-live     → real-time scraper articles (pipeline/upserter.ts)
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import pino from 'pino';
import { Pinecone } from '@pinecone-database/pinecone';
import { HfInference } from '@huggingface/inference';
import { env } from '../config/env';
import { CRYPTO_SOURCES } from '../sources/crypto.sources';
import type { SourceTier } from '../sources/crypto.sources';

const logger = pino({ transport: { target: 'pino-pretty', options: { colorize: true } } });

// ─── Config ───────────────────────────────────────────────────────────────────

const ARCHIVE_DIR  = path.resolve('C:/Users/PC/Desktop/free-crypto-news/archive/articles');
const NAMESPACE    = 'finbot-history';
const CHUNK_SIZE   = 200;   // articles processed per round (embed → upsert)
const EMBED_BATCH  = 32;    // HF feature extraction batch size

// ─── Clients ──────────────────────────────────────────────────────────────────

const pc    = new Pinecone({ apiKey: env.PINECONE_API_KEY });
const index = pc.index(env.PINECONE_INDEX_NAME).namespace(NAMESPACE);
const hf    = new HfInference(env.HUGGINGFACE_API_KEY);

// ─── Source lookup (source_key → tier metadata) ────────────────────────────────

const sourceMap = new Map(CRYPTO_SOURCES.map(s => [s.key, s]));

const SOURCE_FALLBACK = {
  sourceTier:  'tier4' as SourceTier,
  credibility: 0.60,
  reputation:  45,
};

function getSourceMeta(sourceKey: string) {
  return sourceMap.get(sourceKey) ?? SOURCE_FALLBACK;
}

// ─── Sentiment mapping ────────────────────────────────────────────────────────

type SentimentLabel = 'bullish' | 'bearish' | 'neutral';

function mapSentiment(label: string): SentimentLabel {
  const l = label.toLowerCase();
  if (l === 'positive') return 'bullish';
  if (l === 'negative') return 'bearish';
  return 'neutral';
}

function mapSeverity(score: number, label: SentimentLabel): 'high' | 'medium' | 'low' {
  if (label === 'neutral') return 'low';
  if (score >= 0.85) return 'high';
  if (score >= 0.65) return 'medium';
  return 'low';
}

// ─── High-tier filter (defined once, not per-call) ───────────────────────────

const HIGH_TIERS: SourceTier[] = ['tier1', 'tier2', 'research', 'geopolitical'];

// ─── Archive record type (from JSONL schema v2.0.0) ──────────────────────────

interface ArchiveRecord {
  id:             string;
  schema_version: string;
  title:          string;
  pub_date:       string;
  source:         string;
  source_key:     string;
  category:       string;
  tickers:        string[];
  sentiment: {
    score:      number;
    label:      string;
    confidence: number;
  };
  meta: {
    word_count:      number;
    is_breaking:     boolean;
    has_valid_title: boolean;
    has_valid_date:  boolean;
    language?:       string;
  };
}

// ─── Normalized record (what we upsert) ──────────────────────────────────────

interface HistoryRecord {
  id:             string;
  title:          string;
  publishedAt:    string;
  source:         string;
  sourceKey:      string;
  sourceTier:     SourceTier;
  credibility:    number;
  reputation:     number;
  category:       string;
  asset:          string;
  tickers:        string[];
  sentiment:      SentimentLabel;
  sentimentScore: number;
  severity:       'high' | 'medium' | 'low';
  isBreaking:     boolean;
}

// ─── Embed a batch of titles ──────────────────────────────────────────────────

async function embedTexts(texts: string[]): Promise<number[][] | null> {
  try {
    const result = await hf.featureExtraction({
      model:  'sentence-transformers/all-MiniLM-L6-v2',
      inputs: texts,
    });
    return result as number[][];
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'HF embedding batch failed — skipping chunk');
    return null;
  }
}

// ─── Upsert a chunk to Pinecone ────────────────────────────────────────────────

async function upsertChunk(records: HistoryRecord[], vectors: number[][]): Promise<void> {
  const pineconeRecords = records.map((r, i) => ({
    id:     r.id,
    values: vectors[i],
    metadata: {
      title:          r.title,
      source:         r.source,
      sourceTier:     r.sourceTier,
      credibility:    r.credibility,
      reputation:     r.reputation,
      asset:          r.asset,
      tickers:        r.tickers.join(','),
      category:       r.category,
      publishedAt:    r.publishedAt,
      summary:        r.title,              // archive has no body — title is the signal
      sentiment:      r.sentiment,
      sentimentScore: r.sentimentScore,
      severity:       r.severity,
      isBreaking:     r.isBreaking,
      namespace:      NAMESPACE,
    },
  }));

  // Pinecone max upsert batch = 100 vectors
  for (let i = 0; i < pineconeRecords.length; i += 100) {
    await index.upsert({ records: pineconeRecords.slice(i, i + 100) });
  }
}

// ─── Process one chunk: embed → upsert ────────────────────────────────────────

async function processChunk(chunk: HistoryRecord[]): Promise<number> {
  // Embed in sub-batches of EMBED_BATCH, dropping any sub-batch that fails
  const goodRecords: HistoryRecord[] = [];
  const goodVectors: number[][]      = [];

  for (let i = 0; i < chunk.length; i += EMBED_BATCH) {
    const batchRecords = chunk.slice(i, i + EMBED_BATCH);
    const batchTexts   = batchRecords.map(r => r.title);
    const vectors      = await embedTexts(batchTexts);

    if (!vectors) {
      // Sub-batch embedding failed — skip these records entirely (no garbage vectors)
      logger.warn({ skipped: batchRecords.length }, 'Embedding sub-batch failed — records skipped');
      continue;
    }

    goodRecords.push(...batchRecords);
    goodVectors.push(...vectors);
  }

  if (goodRecords.length === 0) return 0;

  await upsertChunk(goodRecords, goodVectors);
  return goodRecords.length;
}

// ─── Parse one line from JSONL ────────────────────────────────────────────────

function parseLine(line: string): HistoryRecord | null {
  let raw: ArchiveRecord;
  try {
    raw = JSON.parse(line) as ArchiveRecord;
  } catch {
    return null;
  }

  // Skip invalid or non-English records
  if (!raw.meta?.has_valid_title || !raw.meta?.has_valid_date) return null;
  if (!raw.title?.trim()) return null;
  if (!raw.pub_date) return null;
  if (raw.meta?.language && raw.meta.language !== 'en') return null;

  const sourceMeta = getSourceMeta(raw.source_key);

  // Only ingest high-credibility sources — tier3/tier4 add noise to signal patterns
  if (!HIGH_TIERS.includes(sourceMeta.sourceTier)) return null;
  const sentLabel    = mapSentiment(raw.sentiment?.label ?? 'neutral');
  const sentScore    = raw.sentiment?.confidence ?? 0.5;
  const asset        = raw.tickers?.[0] ?? 'general';

  return {
    id:             raw.id,
    title:          raw.title.trim(),
    publishedAt:    raw.pub_date,
    source:         raw.source,
    sourceKey:      raw.source_key,
    sourceTier:     sourceMeta.sourceTier,
    credibility:    sourceMeta.credibility,
    reputation:     sourceMeta.reputation,
    category:       raw.category ?? 'general',
    asset,
    tickers:        raw.tickers ?? [],
    sentiment:      sentLabel,
    sentimentScore: sentScore,
    severity:       mapSeverity(sentScore, sentLabel),
    isBreaking:     raw.meta?.is_breaking ?? false,
  };
}

// ─── Stream one JSONL file ────────────────────────────────────────────────────

async function streamFile(
  filePath: string,
  chunk:    HistoryRecord[],
  stats:    { total: number; upserted: number; skipped: number },
): Promise<void> {
  const rl = readline.createInterface({
    input:     fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    const record = parseLine(line);
    if (!record) {
      stats.skipped++;
      continue;
    }

    chunk.push(record);
    stats.total++;

    if (chunk.length >= CHUNK_SIZE) {
      const upserted = await processChunk(chunk);
      stats.upserted += upserted;
      chunk.length = 0; // clear in-place (avoids reallocation)

      logger.info(
        { total: stats.total, upserted: stats.upserted, skipped: stats.skipped },
        'Chunk upserted',
      );
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info({ archiveDir: ARCHIVE_DIR, namespace: NAMESPACE }, 'Bootstrap starting');

  const files = fs.readdirSync(ARCHIVE_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .map(f => path.join(ARCHIVE_DIR, f));

  logger.info({ fileCount: files.length }, 'JSONL files found');

  const stats = { total: 0, upserted: 0, skipped: 0 };
  const chunk: HistoryRecord[] = [];
  const startMs = Date.now();

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    logger.info({ file: path.basename(file), fileIndex: fi + 1, of: files.length }, 'Processing file');
    await streamFile(file, chunk, stats);
  }

  // Flush remaining articles that didn't fill a full chunk
  if (chunk.length > 0) {
    const upserted = await processChunk(chunk);
    stats.upserted += upserted;
  }

  const durationMin = ((Date.now() - startMs) / 60_000).toFixed(1);

  logger.info(
    {
      total:      stats.total,
      upserted:   stats.upserted,
      skipped:    stats.skipped,
      durationMin,
      namespace:  NAMESPACE,
    },
    'Bootstrap complete',
  );
}

main().catch(err => {
  logger.error(err, 'Bootstrap failed');
  process.exit(1);
});
