// DexScreener free API. Returns USD market cap + liquidity for Solana tokens
// (pump.fun tokens are indexed here even on the bonding curve). Batches 30 mints
// per request, throttled to stay under the ~300 req/min limit, keeps the deepest
// pool, and only records tokens we actually asked for (as the pair's base token).

import { CONFIG } from './config.js';
import { log } from './log.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// mints: string[]  ->  Map<mint, {symbol, name, mcap, liquidityUsd, priceUsd, dexId, pairCreatedAt, url}>
export async function getMarketData(mints) {
  const result = new Map();
  const requested = new Set(mints);
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    if (i > 0) await sleep(150); // throttle between batches
    let data;
    try {
      const r = await fetch(`${CONFIG.DEXSCREENER}/${chunk.join(',')}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch (e) {
      log.debug('dexscreener fetch failed:', e.message);
      continue;
    }
    for (const p of data.pairs || []) {
      if (p.chainId !== 'solana') continue;         // pump.fun is Solana-only
      const mint = p.baseToken?.address;
      if (!mint || !requested.has(mint)) continue;  // only our token as base (skip USDC/SOL quote side)
      const liquidityUsd = Number(p.liquidity?.usd || 0);
      const prev = result.get(mint);
      if (prev && prev.liquidityUsd >= liquidityUsd) continue; // keep deepest pool
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
  }
  return result;
}
