import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load .env from the project root regardless of how we're launched (npm, pm2,
// systemd, bare `node`). Harmless if the file is missing or vars are already set.
try { process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), '..', '.env')); } catch {}

export const CONFIG = {
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || '',
  MCAP_TARGET_USD: num('MCAP_TARGET_USD', 1_000_000),
  MAX_AGE_MIN: num('MAX_AGE_MIN', 60),
  MIN_LIQUIDITY_USD: num('MIN_LIQUIDITY_USD', 20_000),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Tiered polling. A token climbing past WARM is "hot" and polled every
  // HOT_INTERVAL so a $500k crossing is caught within seconds; everything else is
  // swept every COLD_INTERVAL just to notice it entering the hot zone.
  WARM_MCAP_USD: num('WARM_MCAP_USD', 100_000),
  HOT_INTERVAL_SEC: num('HOT_INTERVAL_SEC', 6),
  COLD_INTERVAL_SEC: num('COLD_INTERVAL_SEC', 25),

  // Sanity ceiling: no real pump.fun token does this in <1h. Blocks blue-chip /
  // stablecoin pollution (e.g. USDC at $73B) from ever triggering an alert.
  MAX_MCAP_USD: num('MAX_MCAP_USD', 1_000_000_000),

  PUMPPORTAL_WS: 'wss://pumpportal.fun/api/data',
  DEXSCREENER: 'https://api.dexscreener.com/latest/dex/tokens',
};

// Known non-pump mints that must never be tracked or alerted on.
export const DENY_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'So11111111111111111111111111111111111111112',  // wSOL
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',   // mSOL
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',   // JUP
]);

function num(name, dflt) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

export function assertConfig() {
  if (!CONFIG.DISCORD_WEBHOOK_URL.startsWith('https://')) {
    console.error('✖ DISCORD_WEBHOOK_URL is not set. Copy .env.example → .env and paste your webhook URL.');
    process.exit(1);
  }
}
