// pump.fun runner alert
// Fires a Discord message when a token reaches MCAP_TARGET_USD within MAX_AGE_MIN
// of launch.
//
// Design: subscribe to every new token (start its clock), then poll DexScreener
// for the market cap of ALL tracked tokens < MAX_AGE_MIN old. Alert the instant
// any crosses the target. We do NOT depend on pump.fun "migration" events — that
// stream is unreliable (measured ~2 events in 8 min while 3 tokens hit $500k).

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

// mint -> { symbol, name, uri, createdAt, seenAt, alerted }
// createdAt = real launch time (from the new-token stream). It's null only for
// tokens added via the migration safety-net, which are then dated from their
// DEX-pair creation time at poll.
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
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    const now = Date.now();
    for (const [k, v] of s.tracked || []) {
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
    if (!tracked.has(m.mint)) {
      tracked.set(m.mint, { symbol: m.symbol, name: m.name, uri: m.uri, createdAt: Date.now(), alerted: false });
    }
  },
  // Safety net: a token that graduated but we never saw born (started mid-life).
  // Dated from its DEX-pair creation at poll time.
  onMigrate(m) {
    if (!tracked.has(m.mint)) {
      tracked.set(m.mint, { symbol: m.symbol, name: m.name, uri: m.uri, createdAt: null, seenAt: Date.now(), alerted: false });
    }
  },
});

if (process.env.TEST_INJECT_MINT) {
  tracked.set(process.env.TEST_INJECT_MINT, { symbol: 'TEST', name: 'inject', createdAt: Date.now(), alerted: false });
  log.info(`TEST_INJECT_MINT seeded: ${process.env.TEST_INJECT_MINT}`);
}

// Self-scheduling poll loop (no overlap: next poll is scheduled after this one finishes).
async function pollLoop() {
  try { await pollAll(); }
  catch (e) { log.error('poll error:', e.message); }
  if (running) setTimeout(pollLoop, CONFIG.POLL_INTERVAL_SEC * 1000);
}

async function pollAll() {
  pruneOld();
  const mints = [...tracked.keys()].filter((m) => !tracked.get(m).alerted);
  if (!mints.length) return;

  const data = await getMarketData(mints);
  let onDex = 0, near = 0;
  for (const mint of mints) {
    const md = data.get(mint);
    if (!md) continue;
    onDex++;
    const t = tracked.get(mint);
    const anchor = t.createdAt ?? md.pairCreatedAt ?? t.seenAt;
    if (anchor == null) continue;
    const ageMin = (Date.now() - anchor) / 60_000;
    if (ageMin > CONFIG.MAX_AGE_MIN) continue;
    if (md.mcap >= CONFIG.MCAP_TARGET_USD * 0.6) near++;

    if (md.mcap >= CONFIG.MCAP_TARGET_USD && md.liquidityUsd >= CONFIG.MIN_LIQUIDITY_USD) {
      t.alerted = true;
      const [meta, rug] = await Promise.all([fetchTokenMeta(t.uri), getRugReport(mint)]);
      await sendAlert({
        symbol: md.symbol || t.symbol, name: md.name || t.name, mint,
        mcap: md.mcap, ageMin, ageBasis: t.createdAt ? 'launch' : 'graduation',
        liquidityUsd: md.liquidityUsd, url: md.url, meta, rug,
      });
      alerts++;
      saveState();
    }
  }
  log.debug(`poll: tracked ${tracked.size} · on-dex ${onDex} · ≥60% target ${near}`);
}

function pruneOld() {
  const now = Date.now();
  for (const [mint, t] of tracked) {
    const anchor = t.createdAt ?? t.seenAt;
    if (anchor != null && now - anchor > MAX_AGE_MS) tracked.delete(mint);
  }
}

setInterval(() => log.info(`alive · tracking:${tracked.size} · seen:${seen} · alerts:${alerts}`), 60_000);
setInterval(saveState, 30_000);

log.info(`Rule: market cap ≥ $${CONFIG.MCAP_TARGET_USD.toLocaleString()} within ${CONFIG.MAX_AGE_MIN}min, liquidity ≥ $${CONFIG.MIN_LIQUIDITY_USD.toLocaleString()}`);
pollLoop();

function shutdown() { running = false; log.info('shutting down — saving state'); saveState(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (Number(process.env.RUN_SECONDS) > 0) {
  setTimeout(() => { log.info('RUN_SECONDS elapsed — exiting'); shutdown(); }, Number(process.env.RUN_SECONDS) * 1000);
}
