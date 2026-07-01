import { CONFIG } from './config.js';

const ts = () => new Date().toISOString().slice(11, 19);
export const log = {
  info: (...a) => console.log(`[${ts()}]`, ...a),
  debug: (...a) => { if (CONFIG.LOG_LEVEL === 'debug') console.log(`[${ts()}] ·`, ...a); },
  warn: (...a) => console.warn(`[${ts()}] ⚠`, ...a),
  error: (...a) => console.error(`[${ts()}] ✖`, ...a),
};
