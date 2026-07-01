// PumpPortal live feed. subscribeNewToken + subscribeMigration are free and
// need no key. Both streams arrive on one socket; we route by txType.
// Auto-reconnects and re-subscribes on drop.

import { CONFIG } from './config.js';
import { log } from './log.js';

export function startPumpPortal({ onCreate, onMigrate }) {
  let ws;
  let reconnectDelay = 1000;
  let alive = true;

  function connect() {
    ws = new WebSocket(CONFIG.PUMPPORTAL_WS);

    ws.addEventListener('open', () => {
      reconnectDelay = 1000;
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      ws.send(JSON.stringify({ method: 'subscribeMigration' }));
      log.info('PumpPortal connected — watching new tokens + migrations');
    });

    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.message) { log.debug('server:', m.message); return; }
      if (!m.mint) return;
      if (m.txType === 'create') onCreate(m);
      else if (m.txType === 'migrate') onMigrate(m);
      else log.debug('other event:', m.txType, m.mint);
    });

    ws.addEventListener('error', (e) => log.warn('PumpPortal ws error:', e?.message || 'error'));
    ws.addEventListener('close', () => {
      if (!alive) return;
      log.warn(`PumpPortal disconnected — reconnecting in ${reconnectDelay / 1000}s`);
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    });
  }

  connect();
  return { stop() { alive = false; try { ws.close(); } catch {} } };
}
