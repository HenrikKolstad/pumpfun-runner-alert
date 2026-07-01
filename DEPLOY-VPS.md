# Deploy to a VPS (always-on, 24/7)

The bot uses almost no resources — the **cheapest VPS anywhere is plenty**
(1 vCPU / 512MB–1GB RAM). Since you're in Norway, an EU host keeps latency low.

- **Hetzner** CX22 (~€4/mo, German/Finnish data centers) — best value, recommended
- DigitalOcean / Vultr ($4–6/mo, very easy dashboards)
- RackNerd (dirt cheap yearly promos)

Pick **Ubuntu 24.04** as the OS image.

---

## Step 1 — Install Node on the VPS
SSH in (`ssh root@YOUR_VPS_IP`), then:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node -v      # must be v22 or higher (the bot uses Node's built-in WebSocket)
```

## Step 2 — Copy the bot up (run this on YOUR PC, not the VPS)
The project is tiny and has **no dependencies**, so a plain copy works.
In PowerShell on your machine:
```powershell
scp -r "C:\Users\hainr\pumpfun-runner-alert" root@YOUR_VPS_IP:/root/
```
This brings your `.env` (with the webhook) along too — nothing else to set up.

## Step 3 — Start it under pm2 (auto-restart + boot survival)
Back on the VPS:
```bash
npm install -g pm2
cd /root/pumpfun-runner-alert
pm2 start index.js --name pump-alert
pm2 save
pm2 startup          # prints a command — copy/paste & run that one line, then:
pm2 save
```

## Step 4 — Confirm it's alive
```bash
pm2 logs pump-alert       # you should see "PumpPortal connected" + heartbeats
pm2 status                # shows it running
```
Fire a test card any time with:
```bash
cd /root/pumpfun-runner-alert && node test-alert.js
```

---

## Everyday pm2 commands
| Command | Does |
|---|---|
| `pm2 logs pump-alert` | live logs |
| `pm2 restart pump-alert` | restart (e.g. after editing `.env`) |
| `pm2 stop pump-alert` | pause it |
| `pm2 status` | is it running? |

## Updating settings later
Edit `.env` on the VPS (`nano /root/pumpfun-runner-alert/.env`), then
`pm2 restart pump-alert`. Done.

That's it — now it runs 24/7 whether your PC is on or off.
