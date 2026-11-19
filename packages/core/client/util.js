/**
 * Small pure helpers shared by every browser bundle.
 *
 * Nothing in here touches module state: these are the functions that used to
 * live in the monolith's `util` section and are now imported wherever needed.
 */

/** Join truthy class names. */
export function cx() {
  let out = '';
  for (let i = 0; i < arguments.length; i += 1) {
    const part = arguments[i];
    if (part) out += (out === '' ? '' : ' ') + part;
  }
  return out;
}

/** Build a query string from a params object, dropping empty/false values. */
export function qs(params) {
  const u = new URLSearchParams();
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '' && value !== false) u.set(key, String(value));
  }
  const s = u.toString();
  return s === '' ? '' : '?' + s;
}

/** Compact integer rendering for diff stats (100000 → "100k"). */
export function fmtNum(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0';
  if (n >= 100000) return Math.round(n / 1000) + 'k';
  return String(n);
}

/** Relative time in the UI language, with an absolute fallback. */
export function fmtRelTime(ts, lang) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  try {
    const rtf = new Intl.RelativeTimeFormat(lang === 'en' ? 'en' : 'zh', { numeric: 'auto' });
    const mins = Math.round(diff / 60000);
    if (Math.abs(mins) < 60) return rtf.format(-mins, 'minute');
    const hours = Math.round(mins / 60);
    if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour');
    return rtf.format(-Math.round(hours / 24), 'day');
  } catch {
    return new Date(ts).toLocaleString();
  }
}

/** Exact failure text from any {message}|{error:string}|{error:{message}} shape. */
export function failureMessage(result) {
  if (!result) return null;
  if (typeof result.message === 'string' && result.message) return result.message;
  const err = result.error;
  if (typeof err === 'string' && err) return err;
  if (err && typeof err.message === 'string' && err.message) return err.message;
  return null;
}

/** Last path segment, tolerant of trailing slashes. */
export function basenameOf(p) {
  const s = String(p || '').replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

/* paseo-style mnemonic placeholder slug (createNameId equivalent):
 * adj-noun-hhhh — always a valid branch slug (lowercase, single hyphens). */
const MNEMONIC_ADJ = ['amber', 'brave', 'calm', 'clever', 'coral', 'cosmic', 'crimson', 'curious', 'daring', 'dusty', 'eager', 'electric', 'emerald', 'fading', 'fierce', 'floating', 'gentle', 'gilded', 'golden', 'hidden', 'hollow', 'humble', 'icy', 'indigo', 'iron', 'ivory', 'jagged', 'jolly', 'keen', 'lively', 'lunar', 'mellow', 'misty', 'molten', 'muted', 'nifty', 'nimble', 'noble', 'pale', 'patient', 'polar', 'proud', 'quiet', 'radiant', 'rapid', 'rustic', 'sage', 'scarlet', 'serene', 'shadow', 'shifting', 'silent', 'silver', 'solar', 'solid', 'somber', 'swift', 'tender', 'tranquil', 'umber', 'vast', 'velvet', 'vivid', 'wandering', 'warm', 'wild', 'winter', 'witty', 'zealous'];
const MNEMONIC_NOUN = ['anchor', 'arrow', 'aurora', 'badger', 'basalt', 'beacon', 'birch', 'blossom', 'brook', 'canyon', 'cedar', 'cinder', 'cipher', 'cliff', 'comet', 'copper', 'creek', 'crest', 'crystal', 'current', 'dawn', 'delta', 'dune', 'ember', 'estuary', 'falcon', 'fen', 'fjord', 'flint', 'forest', 'forge', 'fossil', 'gale', 'galaxy', 'garden', 'geode', 'glacier', 'glade', 'granite', 'grove', 'harbor', 'heron', 'horizon', 'island', 'ivy', 'lagoon', 'lantern', 'larch', 'lava', 'leaf', 'lynx', 'marsh', 'meadow', 'meteor', 'monsoon', 'moss', 'nebula', 'oak', 'oasis', 'opal', 'orbit', 'otter', 'peak', 'pebble', 'pine', 'prairie', 'quartz', 'quill', 'raven', 'reef', 'ridge', 'river', 'rose', 'sable', 'sequoia', 'shoal', 'sparrow', 'spring', 'steppe', 'stone', 'summit', 'talon', 'thicket', 'tide', 'timber', 'tundra', 'vale', 'vine', 'walrus', 'willow', 'wolf', 'wren', 'yarrow'];

/** A random valid branch slug: `adj-noun-1a2b`. */
export function mnemonicSlug() {
  const adj = MNEMONIC_ADJ[Math.floor(Math.random() * MNEMONIC_ADJ.length)];
  const noun = MNEMONIC_NOUN[Math.floor(Math.random() * MNEMONIC_NOUN.length)];
  const hex = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return adj + '-' + noun + '-' + hex;
}

const CLIENT_CACHE_MAX = 512;

/** LRU-ish bound: every caller wants the same ceiling. */
export function setBoundedClientCache(map, key, value) {
  map.delete(key);
  map.set(key, value);
  while (map.size > CLIENT_CACHE_MAX) map.delete(map.keys().next().value);
}
