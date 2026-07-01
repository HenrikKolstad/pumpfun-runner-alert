# pump.fun runner alert

Pings a **Discord** channel the moment a pump.fun token reaches a target market
cap (default **$1,000,000**) within a time window of launch (default **60 min**).

All data sources are **free** — no API keys, no wallet, no paid feeds.

```
PumpPortal WS (free)   ──▶  every new token (starts its 1h clock)
                                 │
DexScreener API (free)  ◀────────┘  poll market cap of ALL tracked tokens
                                 │
     mcap ≥ target  &  age < window  &  liquidity ≥ floor  ──▶  🔔 Discord webhook
```

It does **not** rely on pump.fun "migration" events — that stream proved
unreliable (measured ~2 events in 8 minutes while 3 tokens hit $500k). Instead it
tracks every new token and reads market caps straight from DexScreener, which
indexes pump.fun tokens directly. State is persisted to disk, so restarts don't
drop in-flight tokens.

## Setup (2 minutes)

1. **Make a Discord webhook:** Server Settings → Integrations → Webhooks → New
   Webhook → pick a channel → **Copy Webhook URL**.
2. `cp .env.example .env` and paste the URL into `DISCORD_WEBHOOK_URL`.
3. `npm start`

That's it. Discord's mobile app push-notifies your phone, so you still get the
alert on your phone.

## Config (`.env`)

| Var | Default | Meaning |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | — | **required** |
| `MCAP_TARGET_USD` | `1000000` | fire at/above this market cap |
| `MAX_AGE_MIN` | `60` | ...and only if the token is younger than this |
| `MIN_LIQUIDITY_USD` | `20000` | ignore thin pools (fake "$1M" from a price glitch) |
| `POLL_INTERVAL_SEC` | `15` | how often graduated tokens are re-checked |
| `LOG_LEVEL` | `info` | set `debug` to watch every token |

Want *any* fast mover, not just $1M? Lower `MCAP_TARGET_USD` (e.g. `500000`).

## Running it 24/7

The catch with any alert bot: it only catches runners **while it's running**.

- **Your PC:** fine, but it must stay awake (disable sleep). It misses tokens
  while asleep/off.
- **A ~$5/mo VPS** (Hetzner, DigitalOcean, Railway, Fly.io): the reliable way.
  `git clone`, add `.env`, `npm start` under `pm2` or a systemd service.

## Caveats (honest)

- **$1M in <1h is rare** — expect few pings. That's the point: only real rockets.
- Only tracks tokens **born while the bot is running** (it needs the launch time
  to measure age).
- DexScreener can lag a few seconds indexing a freshly-migrated pair; the poll
  loop keeps checking, so a real runner is still caught inside the window.
- This is an information tool for memecoins. It does not trade and is not advice.
