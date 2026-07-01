// pump.fun runner alert
// Fires a Discord message when a token reaches MCAP_TARGET_USD within MAX_AGE_MIN
// of launch.
//
// Detection: subscribe to every new token (its clock starts), then poll DexScreener
// for market caps. TIERED so we can afford to check climbers often:
//   • COLD sweep  — every tracked token, every COLD_INTERVAL_SEC, to notice one
//     entering the "hot" zone (>= WARM_MCAP_USD).
//   • HOT poll    — only climbing tokens, every HOT_INTERVAL_SEC, so a $500k
//     crossing is caught within seconds instead of a full ~1-min sweep.
// No dependency on pump.fun "migration" events (that stream is unreliable).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONFIG, DENY_MINTS, assertConfig } from './src/config.js';
import { log } from './src/log.js';
import { startPumpPortal } from './src/pumpportal.js';
import { getMarketData } from './src/dexscreener.js';
import { fetchTokenMeta } from './src/metadata.js';
import { getRugReport } from './src/rugcheck.js';
import { sendAlert } from './src/discord.js';

assertConfig();

// Never let an unexpected throw kill the process (keeps it running instead of
// crash-looping under pm2, which would blind it for stretches).
process.on('uncaughtException', (e) => log.error('uncaughtException:', e?.stack || e?.message || e));
process.on('unhandledRejection', (e) => log.error('unhandledRejection:', e?.message || e));

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, 'state.json');
const MAX_AGE_MS = CONFIG.MAX_AGE_MIN * 60_000;

// mint -> { symbol, name, uri, createdAt, seenAt, mcap, hot, alerted }
const tracked = new Map();
let seen = 0, alerts = 0, running = true;

// --- persistence: survive restarts without dropping in-flight tokens ---
function saveState() {
  try { writeFileSync(STATE_FILE, JSON.stringify({ tracked: [...tracked] })); }
  catch (e) { log.debug('state save failed:', e.message); }
}
function loadState() {
  try {
    if (!existsSync(STATE_FILE)) return;
    const now = Date.now();
    for (const [k, v] of JSON.parse(readFileSync(STATE_FILE, 'utf8')).tracked || []) {
      const anchor = v.createdAt ?? v.seenAt;
      if (anchor == null || now - anchor <= MAX_AGE_MS) tracked.set(k, v);
    }
    if (tracked.size) log.info(`restored ${tracked.size} tracked tokens`);
  } catch (e) { log.debug('state load failed:', e.message); }
}
loadState();

startPumpPortal({
  onCreate(m) {
    seen++;
    if (DENY_MINTS.has(m.mint) || tracked.has(m.mint)) return;
    tracked.set(m.mint, { symbol: m.symbol, name: m.name, uri: m.uri, createdAt: Date.now(), mcap: 0, hot: false, alerted: false });
  },
  onMigrate(m) {
    if (DENY_MINTS.has(m.mint) || tracked.has(m.mint)) return;
    tracked.set(m.mint, { symbol: m.symbol, name: m.name, uri: m.uri, createdAt: null, seenAt: Date.now(), mcap: 0, hot: false, alerted: false });
  },
});

if (process.env.TEST_INJECT_MINT) {
  tracked.set(process.env.TEST_INJECT_MINT, { symbol: 'TEST', name: 'inject', createdAt: Date.now(), mcap: 0, hot: false, alerted: false });
  log.info(`TEST_INJECT_MINT seeded: ${process.env.TEST_INJECT_MINT}`);
}

// Evaluate one token's fresh market data: promote to hot, or alert.
async function evaluate(mint, md) {
  const t = tracked.get(mint);
  if (!t || t.alerted) return;
  if (DENY_MINTS.has(mint) || md.mcap > CONFIG.MAX_MCAP_USD) { t.alerted = true; return; } // pollution guard
  t.mcap = md.mcap;

  const anchor = t.createdAt ?? md.pairCreatedAt ?? t.seenAt;
  if (anchor == null) return;
  const ageMin = (Date.now() - anchor) / 60_000;
  if (ageMin > CONFIG.MAX_AGE_MIN) return;

  if (md.mcap >= CONFIG.MCAP_TARGET_USD && md.liquidityUsd >= CONFIG.MIN_LIQUIDITY_USD) {
    t.alerted = true;
    alerts++;
    try {
      const [meta, rug] = await Promise.all([fetchTokenMeta(t.uri), getRugReport(mint)]);
      await sendAlert({
        symbol: md.symbol || t.symbol, name: md.name || t.name, mint,
        mcap: md.mcap, ageMin, ageBasis: t.createdAt ? 'launch' : 'graduation',
        liquidityUsd: md.liquidityUsd, url: md.url, meta, rug,
      });
    } catch (e) { log.error('alert failed:', e.message); }
    saveState();
  } else if (!t.hot && md.mcap >= CONFIG.WARM_MCAP_USD) {
    t.hot = true;
    log.info(`🔥 $${t.symbol || mint.slice(0, 6)} entered hot zone at $${Math.round(md.mcap).toLocaleString()} — fast-polling`);
  }
}

// COLD: every tracked token, spaced out.
async function coldLoop() {
  try {
    pruneOld();
    const mints = [...tracked.keys()].filter((m) => { const t = tracked.get(m); return !t.alerted && !t.hot; });
    if (mints.length) {
      const data = await getMarketData(mints, 3);
      for (const [mint, md] of data) await evaluate(mint, md);
    }
  } catch (e) { log.error('cold loop error:', e.message); }
  if (running) setTimeout(coldLoop, CONFIG.COLD_INTERVAL_SEC * 1000);
}

// HOT: only climbing tokens, fast.
async function hotLoop() {
  try {
    const mints = [...tracked.keys()].filter((m) => { const t = tracked.get(m); return !t.alerted && t.hot; });
    if (mints.length) {
      const data = await getMarketData(mints, 3);
      for (const [mint, md] of data) await evaluate(mint, md);
    }
  } catch (e) { log.error('hot loop error:', e.message); }
  if (running) setTimeout(hotLoop, CONFIG.HOT_INTERVAL_SEC * 1000);
}

function pruneOld() {
  const now = Date.now();
  for (const [mint, t] of tracked) {
    const anchor = t.createdAt ?? t.seenAt;
    if (anchor != null && now - anchor > MAX_AGE_MS) tracked.delete(mint);
  }
}

setInterval(() => {
  const hot = [...tracked.values()].filter((t) => t.hot && !t.alerted).length;
  log.info(`alive · tracking:${tracked.size} · hot:${hot} · seen:${seen} · alerts:${alerts}`);
}, 60_000);
setInterval(saveState, 30_000);

log.info(`Rule: market cap ≥ $${CONFIG.MCAP_TARGET_USD.toLocaleString()} within ${CONFIG.MAX_AGE_MIN}min, liq ≥ $${CONFIG.MIN_LIQUIDITY_USD.toLocaleString()} · hot zone ≥ $${CONFIG.WARM_MCAP_USD.toLocaleString()}`);
coldLoop();
hotLoop();

function shutdown() { running = false; log.info('shutting down — saving state'); saveState(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (Number(process.env.RUN_SECONDS) > 0) {
  setTimeout(() => { log.info('RUN_SECONDS elapsed — exiting'); shutdown(); }, Number(process.env.RUN_SECONDS) * 1000);
}
