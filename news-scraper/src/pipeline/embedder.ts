import pLimit from 'p-limit';
import pino from 'pino';
import { HfInference } from '@huggingface/inference';
import { Article } from '../types/article';
import { env } from '../config/env';

export interface EmbeddedArticle {
  article: Article;
  vector:  number[];
}

const logger = pino({ transport: { target: 'pino-pretty', options: { colorize: true } } });

const BATCH_SIZE = 32;
const limit      = pLimit(2);

const hf = new HfInference(env.HUGGINGFACE_API_KEY, { provider: 'hf-inference' });

async function embedBatch(texts: string[]): Promise<number[][] | null> {
  try {
    const result = await hf.featureExtraction({
      model:  'sentence-transformers/all-MiniLM-L6-v2',
      inputs: texts,
    });
    return result as number[][];
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'HuggingFace batch failed — skipping');
    return null;
  }
}

export async function embedArticles(articles: Article[]): Promise<EmbeddedArticle[]> {
  const batches: Article[][] = [];

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    batches.push(articles.slice(i, i + BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map(batch =>
      limit(async () => {
        const inputs     = batch.map(a => `${a.title}. ${a.summary}`);
        const embeddings = await embedBatch(inputs);

        if (!embeddings) return []; // batch failed — skip, don't crash

        return batch.map((article, i) => ({
          article,
          vector: embeddings[i],
        }));
      }),
    ),
  );

  const embedded = results.flat();
  logger.info({ total: articles.length, embedded: embedded.length }, 'Embedding complete');
  return embedded;
}
