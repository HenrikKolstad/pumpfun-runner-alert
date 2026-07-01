// pump.fun runner alert
// Fires a Discord message when a token reaches MCAP_TARGET_USD within MAX_AGE_MIN
// of launch. Flow: watch new tokens (start the clock) -> watch migrations (a token
// now has a real DEX pair) -> poll DexScreener for its USD market cap -> alert.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONFIG, assertConfig } from './src/config.js';
import { log } from './src/log.js';
import { startPumpPortal } from './src/pumpportal.js';
import { getMarketData } from './src/dexscreener.js';
import { fetchTokenMeta } from './src/metadata.js';
import { getRugReport } from './src/rugcheck.js';
import { sendAlert } from './src/discord.js';

assertConfig();

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, 'state.json');
const MAX_AGE_MS = CONFIG.MAX_AGE_MIN * 60_000;

// mint -> { symbol, name, uri, createdAt }  — tokens we saw born (createdAt = real
//   launch time). createdAt can be null for tokens we only caught at migration.
const born = new Map();
// mint -> same shape — graduated & in-window, actively polled for market cap.
const watch = new Map();

let seen = 0, migrated = 0, alerted = 0;

// --- State persistence: survive pm2 restarts without dropping in-flight tokens.
function saveState() {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ born: [...born], watch: [...watch] }));
  } catch (e) { log.debug('state save failed:', e.message); }
}
function loadState() {
  try {
    if (!existsSync(STATE_FILE)) return;
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    const now = Date.now();
    const fresh = ([, v]) => v.createdAt == null || now - v.createdAt <= MAX_AGE_MS;
    for (const [k, v] of (s.born || []).filter(fresh)) born.set(k, v);
    for (const [k, v] of (s.watch || []).filter(fresh)) watch.set(k, v);
    if (born.size || watch.size) log.info(`restored state: born ${born.size}, watching ${watch.size}`);
  } catch (e) { log.debug('state load failed:', e.message); }
}
loadState();

startPumpPortal({
  onCreate(m) {
    seen++;
    born.set(m.mint, { symbol: m.symbol, name: m.name, uri: m.uri, createdAt: Date.now() });
    log.debug(`new $${m.symbol} (${born.size} tracked)`);
  },
  onMigrate(m) {
    migrated++;
    // Prefer the record from when we saw it launch (accurate age). If we never
    // saw its birth (born before startup, or a missed event), track it anyway —
    // pollWatchlist will date it from its DEX-pair creation instead of skipping.
    const t = born.get(m.mint) || { symbol: m.symbol, name: m.name, uri: m.uri, createdAt: null };
    if (t.createdAt != null && (Date.now() - t.createdAt) > MAX_AGE_MS) return;
    watch.set(m.mint, { ...t, watchedAt: Date.now() });
    const label = t.symbol ? `$${t.symbol}` : m.mint.slice(0, 6);
    log.info(`⤴ ${label} graduated (${t.createdAt ? 'seen born' : 'age from graduation'}) — watching for $${CONFIG.MCAP_TARGET_USD.toLocaleString()}`);
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

    // Age from real launch time if we saw it born; otherwise from DEX-pair
    // creation (~graduation). Skip if we can't establish either yet.
    const anchor = t.createdAt ?? md.pairCreatedAt;
    if (anchor == null) continue;
    const ageMin = (Date.now() - anchor) / 60_000;
    const ageBasis = t.createdAt ? 'launch' : 'graduation';

    if (md.mcap >= CONFIG.MCAP_TARGET_USD && md.liquidityUsd >= CONFIG.MIN_LIQUIDITY_USD && ageMin <= CONFIG.MAX_AGE_MIN) {
      const [meta, rug] = await Promise.all([fetchTokenMeta(t.uri), getRugReport(mint)]);
      await sendAlert({
        symbol: md.symbol || t.symbol,
        name: md.name || t.name,
        mint,
        mcap: md.mcap,
        ageMin,
        ageBasis,
        liquidityUsd: md.liquidityUsd,
        url: md.url,
        meta,
        rug,
      });
      alerted++;
      watch.delete(mint); // one alert per token
      born.delete(mint);
      saveState();
    } else if (ageMin > CONFIG.MAX_AGE_MIN) {
      watch.delete(mint); // aged out — stop polling
    } else {
      log.debug(`$${md.symbol} $${Math.round(md.mcap).toLocaleString()} mcap · liq $${Math.round(md.liquidityUsd).toLocaleString()} · ${ageMin.toFixed(0)}min (${ageBasis})`);
    }
  }
}

function pruneOld() {
  const now = Date.now();
  for (const [mint, t] of born) if (now - t.createdAt > MAX_AGE_MS) born.delete(mint);
  // For fallback (no launch time) entries, bound by when they entered the watchlist.
  for (const [mint, t] of watch) if (now - (t.createdAt ?? t.watchedAt) > MAX_AGE_MS) watch.delete(mint);
}

// Heartbeat so you can see it's alive.
setInterval(() => {
  log.info(`alive · born<${CONFIG.MAX_AGE_MIN}m:${born.size} watching:${watch.size} · seen:${seen} migrated:${migrated} alerts:${alerted}`);
}, 60_000);

// Persist tracked tokens periodically so a restart doesn't drop in-flight ones.
setInterval(saveState, 30_000);

log.info(`Rule: market cap ≥ $${CONFIG.MCAP_TARGET_USD.toLocaleString()} within ${CONFIG.MAX_AGE_MIN}min, liquidity ≥ $${CONFIG.MIN_LIQUIDITY_USD.toLocaleString()}`);

function shutdown() { log.info('shutting down — saving state'); saveState(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown); // pm2 restart/stop sends SIGINT then SIGTERM

// Optional: auto-exit after N seconds (for testing / CI). Unset in production.
if (Number(process.env.RUN_SECONDS) > 0) {
  setTimeout(() => { log.info(`RUN_SECONDS elapsed — exiting`); shutdown(); }, Number(process.env.RUN_SECONDS) * 1000);
}
