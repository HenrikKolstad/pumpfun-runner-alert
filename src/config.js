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
  POLL_INTERVAL_SEC: num('POLL_INTERVAL_SEC', 15),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  PUMPPORTAL_WS: 'wss://pumpportal.fun/api/data',
  DEXSCREENER: 'https://api.dexscreener.com/latest/dex/tokens',
};

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
