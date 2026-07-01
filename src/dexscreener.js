// DexScreener free API. Returns USD market cap + liquidity for graduated tokens.
// Batches up to 30 mints per request; groups pairs by token; keeps the deepest pool.

import { CONFIG } from './config.js';
import { log } from './log.js';

// mints: string[]  ->  Map<mint, {symbol, name, mcap, liquidityUsd, priceUsd, dexId, url}>
export async function getMarketData(mints) {
  const result = new Map();
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
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
      if (p.chainId !== 'solana') continue; // pump.fun is Solana-only; ignore any other chain
      const mint = p.baseToken?.address;
      if (!mint) continue;
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
        pairCreatedAt: p.pairCreatedAt ? Number(p.pairCreatedAt) : null, // ~graduation time
        url: p.url || `https://dexscreener.com/solana/${mint}`,
      });
    }
  }
  return result;
}
