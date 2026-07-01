// DexScreener free API. Returns USD market cap + liquidity for Solana tokens
// (pump.fun tokens are indexed here even on the bonding curve). Batches 30 mints
// per request with bounded concurrency (stays under ~300 req/min), keeps the
// deepest pool, and only records tokens we actually asked for (as the base token).

import { CONFIG } from './config.js';
import { log } from './log.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// mints: string[]  ->  Map<mint, {symbol, name, mcap, liquidityUsd, priceUsd, dexId, pairCreatedAt, url}>
export async function getMarketData(mints, concurrency = 3) {
  const result = new Map();
  const requested = new Set(mints);
  const chunks = [];
  for (let i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));

  let idx = 0;
  async function worker() {
    while (idx < chunks.length) {
      const chunk = chunks[idx++];
      await sleep(120); // per-worker spacing; with 3 workers ≈ 250 req/min
      try {
        const r = await fetch(`${CONFIG.DEXSCREENER}/${chunk.join(',')}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        for (const p of data.pairs || []) {
          if (p.chainId !== 'solana') continue;
          const mint = p.baseToken?.address;
          if (!mint || !requested.has(mint)) continue;
          const liquidityUsd = Number(p.liquidity?.usd || 0);
          const prev = result.get(mint);
          if (prev && prev.liquidityUsd >= liquidityUsd) continue; // deepest pool
          result.set(mint, {
            symbol: p.baseToken?.symbol,
            name: p.baseToken?.name,
            mcap: Number(p.marketCap ?? p.fdv ?? 0),
            liquidityUsd,
            priceUsd: Number(p.priceUsd || 0),
            dexId: p.dexId,
            pairCreatedAt: p.pairCreatedAt ? Number(p.pairCreatedAt) : null,
            url: p.url || `https://dexscreener.com/solana/${mint}`,
          });
        }
      } catch (e) {
        log.debug('dexscreener batch failed:', e.message);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length || 1) }, worker));
  return result;
}
