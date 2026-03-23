import { Pinecone } from '@pinecone-database/pinecone';
import { HfInference } from '@huggingface/inference';
import { env } from '../config/env';

const pc = new Pinecone({ apiKey: env.PINECONE_API_KEY });
const hf = new HfInference(env.HUGGINGFACE_API_KEY);

const EMBED_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';

export async function embedText(text: string): Promise<number[]> {
  const result = await hf.featureExtraction({ model: EMBED_MODEL, inputs: text });
  return result as number[];
}

export function getLiveIndex() {
  return pc.index(env.PINECONE_INDEX_NAME).namespace('finbot-live');
}

export function getHistoryIndex() {
  return pc.index(env.PINECONE_INDEX_NAME).namespace('finbot-history');
}

export interface QueryOptions {
  topK?: number;
  filter?: Record<string, unknown>;
}

export async function querySimilar(
  namespace: 'finbot-live' | 'finbot-history',
  vector: number[],
  options: QueryOptions = {},
) {
  const index = namespace === 'finbot-live' ? getLiveIndex() : getHistoryIndex();
  return index.query({
    vector,
    topK: options.topK ?? 10,
    filter: options.filter,
    includeMetadata: true,
  });
}
