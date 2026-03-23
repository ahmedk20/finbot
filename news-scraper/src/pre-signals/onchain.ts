/**
 * On-Chain Analytics — BTC mempool, ETH gas, whale detection, network metrics.
 * Sources: mempool.space (free), Blockchair (free), Etherscan (freemium), Glassnode (freemium).
 * Adapted from free-crypto-news (github.com/nirholas/free-crypto-news).
 */

import { mempoolSpace, blockchairBtc, etherscan, glassnode } from './adapters';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GasPrice {
  chain:      string;
  low:        number;
  average:    number;
  high:       number;
  baseFee?:   number;
  timestamp:  number;
}

export interface BitcoinMempool {
  count:     number;
  vsize:     number;
  totalFee:  number;
  feeHistogram: [number, number][];
  recommendedFees: {
    fastestFee:   number;
    halfHourFee:  number;
    hourFee:      number;
    economyFee:   number;
    minimumFee:   number;
  };
}

export interface WhaleTransaction {
  hash:                 string;
  from:                 string;
  to:                   string;
  value:                number;
  chain:                string;
  timestamp:            number;
  isExchangeDeposit:    boolean;
  isExchangeWithdrawal: boolean;
}

export interface NetworkMetric {
  metric:     string;
  value:      number;
  unit:       string;
  timestamp:  number;
  change24h?: number;
}

// ─── Ethereum ─────────────────────────────────────────────────────────────────

/**
 * Current Ethereum gas prices from Etherscan.
 */
export async function getEthGasPrice(): Promise<GasPrice> {
  const data = await etherscan.fetch<{
    result: { SafeGasPrice: string; ProposeGasPrice: string; FastGasPrice: string; suggestBaseFee: string };
  }>('', {
    module: 'gastracker',
    action: 'gasoracle',
  });

  return {
    chain:     'ethereum',
    low:       parseFloat(data.result.SafeGasPrice),
    average:   parseFloat(data.result.ProposeGasPrice),
    high:      parseFloat(data.result.FastGasPrice),
    baseFee:   parseFloat(data.result.suggestBaseFee),
    timestamp: Date.now(),
  };
}

/**
 * Detect large ETH whale transactions in the latest block.
 */
export async function detectWhaleTransactions(minValueEth = 100): Promise<WhaleTransaction[]> {
  const blockData = await etherscan.fetch<any>('', {
    module:  'proxy',
    action:  'eth_getBlockByNumber',
    tag:     'latest',
    boolean: 'true',
  });

  if (!blockData.result?.transactions) return [];

  const KNOWN_EXCHANGES = [
    '0x28c6c06298d514db089934071355e5743bf21d60', // Binance
    '0x21a31ee1afc51d94c2efccaa2092ad1028285549', // Binance
    '0x503828976d22510aad0201ac7ec88293211d23da', // Coinbase
    '0x71660c4005ba85c37ccec55d0c4493e66fe775d3', // Coinbase
    '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', // OKX
    '0xd24400ae8bfebb18ca49be86258a3c749cf46853', // Gemini
    '0xfdb16996831753d5331ff813c29a93c76834a0ad', // Kraken
  ];

  const threshold = BigInt(Math.floor(minValueEth * 1e18));
  const whales: WhaleTransaction[] = [];

  for (const tx of blockData.result.transactions) {
    const value = BigInt(tx.value || '0x0');
    if (value >= threshold) {
      const toAddr   = (tx.to  || '').toLowerCase();
      const fromAddr = tx.from.toLowerCase();
      whales.push({
        hash:                 tx.hash,
        from:                 tx.from,
        to:                   tx.to || '',
        value:                Number(value) / 1e18,
        chain:                'ethereum',
        timestamp:            parseInt(blockData.result.timestamp, 16) * 1000,
        isExchangeDeposit:    KNOWN_EXCHANGES.includes(toAddr),
        isExchangeWithdrawal: KNOWN_EXCHANGES.includes(fromAddr),
      });
    }
  }

  return whales;
}

// ─── Bitcoin ──────────────────────────────────────────────────────────────────

/**
 * Bitcoin mempool status and recommended fees from mempool.space.
 */
export async function getBitcoinMempool(): Promise<BitcoinMempool> {
  const [mempool, fees] = await Promise.all([
    mempoolSpace.fetch<{ count: number; vsize: number; total_fee: number; fee_histogram: [number, number][] }>(
      '/v1/mempool',
    ),
    mempoolSpace.fetch<{
      fastestFee: number; halfHourFee: number; hourFee: number;
      economyFee: number; minimumFee: number;
    }>('/v1/fees/recommended'),
  ]);

  return {
    count:        mempool.count,
    vsize:        mempool.vsize,
    totalFee:     mempool.total_fee,
    feeHistogram: mempool.fee_histogram || [],
    recommendedFees: fees,
  };
}

/**
 * Bitcoin hashrate and difficulty from mempool.space.
 */
export async function getBitcoinHashrate(): Promise<{
  currentHashrate:   number;
  currentDifficulty: number;
  difficultyChange:  number;
  remainingBlocks:   number;
  remainingTime:     number;
}> {
  const [data, difficulty] = await Promise.all([
    mempoolSpace.fetch<any>('/v1/mining/hashrate/1m'),
    mempoolSpace.fetch<any>('/v1/difficulty-adjustment'),
  ]);

  return {
    currentHashrate:   data.currentHashrate   || 0,
    currentDifficulty: data.currentDifficulty || 0,
    difficultyChange:  difficulty.difficultyChange  || 0,
    remainingBlocks:   difficulty.remainingBlocks   || 0,
    remainingTime:     difficulty.remainingTime     || 0,
  };
}

/**
 * Bitcoin network stats from Blockchair.
 */
export async function getBitcoinStats(): Promise<any> {
  const data = await blockchairBtc.fetch<{ data: any }>('/stats');
  return data.data;
}

// ─── Glassnode ────────────────────────────────────────────────────────────────

/**
 * On-chain metric from Glassnode (requires GLASSNODE_API_KEY for most metrics).
 */
export async function getGlassnodeMetric(
  asset: string,
  metric: string,
  options?: { since?: number; until?: number; interval?: '1h' | '24h' | '1w' },
): Promise<NetworkMetric[]> {
  const data = await glassnode.fetch<{ data: any[] }>(`/metrics/${metric}`, {
    a: asset,
    s: options?.since?.toString()  || '',
    u: options?.until?.toString()  || '',
    i: options?.interval           || '24h',
  });

  return (data?.data || []).map((d: any) => ({
    metric,
    value:     d.v || d.o?.v || 0,
    unit:      '',
    timestamp: (d.t || 0) * 1000,
  }));
}

// ─── Aggregated dashboard ─────────────────────────────────────────────────────

/**
 * Full on-chain snapshot — gas + mempool + BTC stats.
 * Fails gracefully per source; one source down ≠ full failure.
 */
export async function getOnChainSnapshot(): Promise<{
  ethGas:     GasPrice | null;
  btcMempool: BitcoinMempool | null;
  btcStats:   any;
}> {
  const [ethGas, btcMempool, btcStats] = await Promise.allSettled([
    getEthGasPrice(),
    getBitcoinMempool(),
    getBitcoinStats(),
  ]);

  return {
    ethGas:     ethGas.status     === 'fulfilled' ? ethGas.value     : null,
    btcMempool: btcMempool.status === 'fulfilled' ? btcMempool.value : null,
    btcStats:   btcStats.status   === 'fulfilled' ? btcStats.value   : null,
  };
}
