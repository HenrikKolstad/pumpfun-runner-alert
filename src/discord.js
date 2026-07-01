// Discord webhook alert. No auth beyond the webhook URL.

import { CONFIG } from './config.js';
import { log } from './log.js';

// Build the "🛡️ Rug check" field value from a RugCheck report.
function rugField(rug, mint) {
  const link = `[full RugCheck report](https://rugcheck.xyz/tokens/${mint})`;
  if (!rug || !rug.ok) return `_not indexed yet_ · ${link}`;

  const pct = (v) => (v == null ? '?' : `${v.toFixed(1)}%`);
  const auth = (active) => (active ? '🚩 ACTIVE' : '✅ renounced');
  const lines = [
    `👥 Holders: **${rug.holders ? rug.holders.toLocaleString() : '?'}**  ·  🎯 Top10 (ex-pool): **${pct(rug.top10Pct)}**  ·  👤 Dev: **${pct(rug.creatorPct)}**`,
    `🔑 Mint: ${auth(rug.mintAuthorityActive)}  ·  ❄️ Freeze: ${auth(rug.freezeAuthorityActive)}`,
  ];
  if (rug.insiders) lines.push(`🕵️ Insider-linked wallets: **${rug.insiders.toLocaleString()}**`);
  const flags = (rug.risks || []).map((r) => `${r.level === 'danger' ? '🚩' : '⚠️'} ${r.name}`);
  if (flags.length) lines.push(`Flags: ${flags.slice(0, 6).join(' · ')}`);
  if (rug.rugged) lines.unshift('💀 **FLAGGED AS RUGGED**');
  lines.push(`RugCheck score: ${rug.score ?? '?'} · ${link}`);
  return lines.join('\n');
}

export async function sendAlert({ symbol, name, mint, mcap, ageMin, ageBasis = 'launch', liquidityUsd, url, meta = {}, rug = null }) {
  const ageWord = ageBasis === 'graduation' ? 'since graduating' : 'from launch';
  // "What it's about": the creator's own blurb.
  const blurb = (meta.description || '').replace(/\s+/g, ' ').trim();
  const about = blurb ? (blurb.length > 350 ? blurb.slice(0, 349) + '…' : blurb) : '_no description provided_';

  // "Who": socials from the token metadata.
  const socials = [
    meta.twitter && `[Twitter/X](${meta.twitter})`,
    meta.telegram && `[Telegram](${meta.telegram})`,
    meta.website && `[Website](${meta.website})`,
  ].filter(Boolean).join(' · ');

  const fields = [
    { name: 'Market cap', value: `$${fmt(mcap)}`, inline: true },
    { name: 'Age', value: `${ageMin.toFixed(1)} min`, inline: true },
    { name: 'Liquidity', value: `$${fmt(liquidityUsd)}`, inline: true },
    { name: 'What it is', value: about, inline: false },
    { name: '🛡️ Rug check', value: rugField(rug, mint), inline: false },
    { name: '📋 Token address', value: `\`\`\`${mint}\`\`\``, inline: false },
  ];
  if (socials) fields.push({ name: 'Who / links', value: socials, inline: false });
  fields.push({ name: 'Trade / chart', value: `[pump.fun](https://pump.fun/coin/${mint}) · [DexScreener](${url})`, inline: false });

  const embed = {
    title: `🚀 $${symbol || '?'} hit $${fmt(mcap)} market cap`,
    description: `**${name || symbol}** reached **$${fmt(mcap)}** in **${ageMin.toFixed(0)} min** ${ageWord}.`,
    color: 0x00e5a0,
    fields,
    timestamp: new Date().toISOString(),
  };
  if (meta.image) embed.thumbnail = { url: meta.image };

  log.debug('alert payload:', JSON.stringify(embed));
  try {
    const r = await fetch(CONFIG.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pump.fun runner alert', embeds: [embed] }),
    });
    if (!r.ok) log.warn('discord webhook returned', r.status, await r.text().catch(() => ''));
    else log.info(`🔔 alerted $${symbol} — $${fmt(mcap)} in ${ageMin.toFixed(0)}min`);
  } catch (e) {
    log.error('discord send failed:', e.message);
  }
}

function fmt(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
