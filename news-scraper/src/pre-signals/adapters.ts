/**
 * Lightweight HTTP adapter factory for pre-signals data sources.
 * Uses fetchJSON (circuit breaker + retries + concurrency) instead of plain axios.
 */

import { fetchJSON } from '../lib/fetcher';

export interface AdapterConfig {
  name:     string;
  baseUrl:  string;
  envKey?:  string;   // env var name for API key
  timeout?: number;
  headers?: Record<string, string>;
}

export interface Adapter {
  fetch<T = unknown>(endpoint: string, params?: Record<string, string>): Promise<T>;
}

export function createAdapter(config: AdapterConfig): Adapter {
  const apiKey  = config.envKey ? process.env[config.envKey] : undefined;
  const timeout = config.timeout ?? 10_000;

  const headers: Record<string, string> = {
    ...config.headers,
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };

  return {
    async fetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
      const url = new URL(endpoint, config.baseUrl + '/').toString();
      const qs  = params ? '?' + new URLSearchParams(params).toString() : '';
      return fetchJSON<T>(url + qs, { timeout, headers });
    },
  };
}

// ─── Shared adapters used by onchain / derivatives / social ──────────────────

export const mempoolSpace = createAdapter({
  name:    'mempool-space',
  baseUrl: 'https://mempool.space/api',
});

export const blockchairBtc = createAdapter({
  name:    'blockchair-btc',
  baseUrl: 'https://api.blockchair.com/bitcoin',
});

export const etherscan = createAdapter({
  name:    'etherscan',
  baseUrl: 'https://api.etherscan.io/api',
  envKey:  'ETHERSCAN_API_KEY',
});

export const glassnode = createAdapter({
  name:    'glassnode',
  baseUrl: 'https://api.glassnode.com/v1',
  envKey:  'GLASSNODE_API_KEY',
});

export const coinglass = createAdapter({
  name:    'coinglass',
  baseUrl: 'https://open-api.coinglass.com/public/v2',
  envKey:  'COINGLASS_API_KEY',
});

export const deribit = createAdapter({
  name:    'deribit',
  baseUrl: 'https://www.deribit.com/api/v2/public',
});

export const bybit = createAdapter({
  name:    'bybit',
  baseUrl: 'https://api.bybit.com/v5',
});

export const okx = createAdapter({
  name:    'okx',
  baseUrl: 'https://www.okx.com/api/v5',
});

export const lunarcrush = createAdapter({
  name:    'lunarcrush',
  baseUrl: 'https://lunarcrush.com/api4/public',
  envKey:  'LUNARCRUSH_API_KEY',
});

export const alternative = createAdapter({
  name:    'alternative-me',
  baseUrl: 'https://api.alternative.me',
});
