// Fetches a pump.fun token's metadata JSON (from the `uri` on the launch event).
// Gives the creator's own description ("what it's about") + socials ("who").

import { log } from './log.js';

const EMPTY = { description: '', image: '', website: '', twitter: '', telegram: '' };

export async function fetchTokenMeta(uri) {
  if (!uri) return { ...EMPTY };
  try {
    const r = await fetch(uri, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return {
      description: (j.description || '').trim(),
      image: j.image || '',
      website: j.website || '',
      twitter: j.twitter || '',
      telegram: j.telegram || '',
    };
  } catch (e) {
    log.debug('metadata fetch failed:', e.message);
    return { ...EMPTY };
  }
}
