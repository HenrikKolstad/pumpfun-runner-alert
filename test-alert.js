// Sends ONE sample alert to your configured Discord webhook so you can confirm
// delivery works — without waiting for a real $1M runner.
//   npm run test-alert
import { assertConfig } from './src/config.js';
import { getRugReport } from './src/rugcheck.js';
import { sendAlert } from './src/discord.js';

assertConfig();

// Use a real mint so the rug-check section shows live data in the test card.
const mint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // BONK
const rug = await getRugReport(mint);

await sendAlert({
  symbol: 'TEST',
  name: 'Test Runner',
  mint,
  mcap: 750_000,
  ageMin: 42,
  liquidityUsd: 50_000,
  url: 'https://dexscreener.com/solana',
  meta: {
    description: '✅ If you can read this in Discord, your webhook works and the bot is ready to go live.',
    twitter: 'https://x.com/pumpdotfun',
    website: 'https://pump.fun',
  },
  rug,
});

console.log('Sent a test alert — check your Discord channel.');
