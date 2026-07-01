// PumpPortal live feed. subscribeNewToken + subscribeMigration are free and need
// no key. Both streams arrive on one socket; we route by txType.
//
// Robust reconnection: pump.fun emits new tokens constantly, so a healthy socket
// is never quiet. A WATCHDOG force-reconnects if we hear nothing for a while —
// this catches "zombie" sockets that look connected but silently stopped
// delivering (which froze the bot at tracking:0 for over an hour).

import { CONFIG } from './config.js';
import { log } from './log.js';

const SILENCE_LIMIT_MS = 45_000; // healthy stream is never this quiet

export function startPumpPortal({ onCreate, onMigrate }) {
  let ws = null;
  let reconnectDelay = 1000;
  let reconnectTimer = null;
  let lastMsgAt = Date.now();
  let alive = true;

  function scheduleReconnect() {
    if (!alive || reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  }

  function connect() {
    // Tear down any previous socket so listeners/handles don't leak or stack.
    if (ws) { try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; ws.close(); } catch {} }

    ws = new WebSocket(CONFIG.PUMPPORTAL_WS);
    lastMsgAt = Date.now();

    ws.addEventListener('open', () => {
      reconnectDelay = 1000;
      lastMsgAt = Date.now();
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      ws.send(JSON.stringify({ method: 'subscribeMigration' }));
      log.info('PumpPortal connected — watching new tokens + migrations');
    });

    ws.addEventListener('message', (ev) => {
      lastMsgAt = Date.now();
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.message) { log.debug('server:', m.message); return; }
      if (!m.mint) return;
      if (m.txType === 'create') onCreate(m);
      else if (m.txType === 'migrate') onMigrate(m);
    });

    ws.addEventListener('error', (e) => log.warn('PumpPortal ws error:', e?.message || 'error'));
    ws.addEventListener('close', () => {
      if (!alive) return;
      log.warn(`PumpPortal disconnected — reconnecting in ${reconnectDelay / 1000}s`);
      scheduleReconnect();
    });
  }

  connect();

  // Watchdog: if the stream goes silent (dead or zombie socket), force a fresh
  // connection even when no close/error event fired.
  const watchdog = setInterval(() => {
    if (!alive) return;
    if (Date.now() - lastMsgAt > SILENCE_LIMIT_MS) {
      log.warn(`PumpPortal silent >${SILENCE_LIMIT_MS / 1000}s — forcing reconnect`);
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      reconnectDelay = 1000;
      connect();
    }
  }, 15_000);

  return { stop() { alive = false; clearInterval(watchdog); try { ws && ws.close(); } catch {} } };
}
