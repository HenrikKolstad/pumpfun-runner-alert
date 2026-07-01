// pump.fun runner alert
// Fires a Discord message when a token reaches MCAP_TARGET_USD within MAX_AGE_MIN
// of launch. Flow: watch new tokens (start the clock) -> watch migrations (a token
// now has a real DEX pair) -> poll DexScreener for its USD market cap -> alert.

import { CONFIG, assertConfig } from './src/config.js';
import { log } from './src/log.js';
import { startPumpPortal } from './src/pumpportal.js';
import { getMarketData } from './src/dexscreener.js';
import { fetchTokenMeta } from './src/metadata.js';
import { getRugReport } from './src/rugcheck.js';
import { sendAlert } from './src/discord.js';

assertConfig();

const MAX_AGE_MS = CONFIG.MAX_AGE_MIN * 60_000;

// mint -> { symbol, name, createdAt }  — every token we saw born, still < MAX_AGE
const born = new Map();
// mint -> { symbol, name, createdAt }  — graduated & in-window, actively polled
const watch = new Map();

let seen = 0, migrated = 0, alerted = 0;

startPumpPortal({
  onCreate(m) {
    seen++;
    born.set(m.mint, { symbol: m.symbol, name: m.name, uri: m.uri, createdAt: Date.now() });
    log.debug(`new $${m.symbol} (${born.size} tracked)`);
  },
  onMigrate(m) {
    migrated++;
    const t = born.get(m.mint);
    if (!t) { log.debug(`migrate ${m.mint} — not seen at birth, skipping`); return; }
    const ageMin = (Date.now() - t.createdAt) / 60_000;
    if (ageMin > CONFIG.MAX_AGE_MIN) return;
    watch.set(m.mint, t);
    log.info(`⤴ $${t.symbol} graduated at ${ageMin.toFixed(1)}min — now watching for $${CONFIG.MCAP_TARGET_USD.toLocaleString()}`);
  },
});

// Test hook: seed a known graduated mint straight into the watchlist to exercise
// the poll → alert path deterministically (real migrations are infrequent).
if (process.env.TEST_INJECT_MINT) {
  const mint = process.env.TEST_INJECT_MINT;
  born.set(mint, { symbol: 'TEST', name: 'inject', createdAt: Date.now() });
  watch.set(mint, born.get(mint));
  log.info(`TEST_INJECT_MINT seeded: ${mint}`);
}

// Poll loop: check every graduated in-window token's live market cap.
setInterval(pollWatchlist, CONFIG.POLL_INTERVAL_SEC * 1000);

async function pollWatchlist() {
  pruneOld();
  if (watch.size === 0) return;

  const mints = [...watch.keys()];
  const data = await getMarketData(mints);

  for (const [mint, t] of watch) {
    const md = data.get(mint);
    if (!md) continue;
    const ageMin = (Date.now() - t.createdAt) / 60_000;

    if (md.mcap >= CONFIG.MCAP_TARGET_USD && md.liquidityUsd >= CONFIG.MIN_LIQUIDITY_USD && ageMin <= CONFIG.MAX_AGE_MIN) {
      const [meta, rug] = await Promise.all([fetchTokenMeta(t.uri), getRugReport(mint)]);
      await sendAlert({
        symbol: md.symbol || t.symbol,
        name: md.name || t.name,
        mint,
        mcap: md.mcap,
        ageMin,
        liquidityUsd: md.liquidityUsd,
        url: md.url,
        meta,
        rug,
      });
      alerted++;
      watch.delete(mint); // one alert per token
      born.delete(mint);
    } else {
      log.debug(`$${md.symbol} $${Math.round(md.mcap).toLocaleString()} mcap · liq $${Math.round(md.liquidityUsd).toLocaleString()} · ${ageMin.toFixed(0)}min`);
    }
  }
}

function pruneOld() {
  const now = Date.now();
  for (const [mint, t] of born) if (now - t.createdAt > MAX_AGE_MS) born.delete(mint);
  for (const [mint, t] of watch) if (now - t.createdAt > MAX_AGE_MS) watch.delete(mint);
}

// Heartbeat so you can see it's alive.
setInterval(() => {
  log.info(`alive · born<${CONFIG.MAX_AGE_MIN}m:${born.size} watching:${watch.size} · seen:${seen} migrated:${migrated} alerts:${alerted}`);
}, 60_000);

log.info(`Rule: market cap ≥ $${CONFIG.MCAP_TARGET_USD.toLocaleString()} within ${CONFIG.MAX_AGE_MIN}min, liquidity ≥ $${CONFIG.MIN_LIQUIDITY_USD.toLocaleString()}`);

process.on('SIGINT', () => { log.info('shutting down'); process.exit(0); });

// Optional: auto-exit after N seconds (for testing / CI). Unset in production.
if (Number(process.env.RUN_SECONDS) > 0) {
  setTimeout(() => { log.info(`RUN_SECONDS elapsed — exiting`); process.exit(0); }, Number(process.env.RUN_SECONDS) * 1000);
}
