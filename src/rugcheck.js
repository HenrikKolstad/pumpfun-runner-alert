// RugCheck.xyz — free rug-analysis API. One call gives holder count, top-holder
// concentration (with LP pools labelled so we can exclude them), dev/creator
// holdings, mint/freeze authority status, and human-readable risk flags.

import { log } from './log.js';

export async function getRugReport(mint) {
  try {
    const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {
      signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();

    // Exclude AMM/LP pool accounts from "concentration" — pool-held supply is
    // liquidity, not insider risk.
    const known = d.knownAccounts || {};
    const isPool = (h) => {
      const t = known[h.address]?.type || known[h.owner]?.type || '';
      return /amm|lp|pool|market/i.test(t);
    };
    const nonPool = (d.topHolders || []).filter((h) => !isPool(h));
    const top10Pct = nonPool.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0);

    let creatorPct = null;
    if (d.creatorBalance != null && d.token?.supply) {
      creatorPct = (Number(d.creatorBalance) / Number(d.token.supply)) * 100;
    }

    return {
      ok: true,
      score: d.score_normalised ?? null,
      rugged: !!d.rugged,
      holders: d.totalHolders ?? null,
      top10Pct,
      creatorPct,
      mintAuthorityActive: d.mintAuthority != null,     // true = dev can mint more (danger)
      freezeAuthorityActive: d.freezeAuthority != null, // true = dev can freeze wallets (danger)
      lpLockedPct: d.markets?.[0]?.lp?.lpLockedPct ?? d.lpLockedPct ?? null,
      insiders: d.graphInsidersDetected ?? null,
      risks: (d.risks || []).map((x) => ({ name: x.name, level: x.level })),
    };
  } catch (e) {
    log.debug('rugcheck failed:', e.message);
    return { ok: false };
  }
}
