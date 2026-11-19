/**
 * Locale registration shared by every feature bundle.
 *
 * Each bundle registers exactly one namespace (`bw-diff`, `bw-worktree`,
 * `bw-status`, `bw-forge`) with the dictionaries it owns. Because every bundle
 * carries its own copy of this module, the module-level `t` below is the
 * translator of the one namespace that bundle registered — components import
 * `t` and call it at render time.
 *
 * `registerLocale` returns that same live translator, so an entry can also keep
 * a local reference. The `{var}` interpolation contract of 0.3.x is unchanged.
 */

import { getAppCtx } from './runtime.js';

/** The translator a bundle's components use; replaced by `registerLocale`. */
let currentTranslate = (key) => key;

/** Interpolate `{name}` placeholders in one message (legacy fallback path). */
export function interpolate(template, params) {
  if (typeof template !== 'string') return template;
  if (!params) return template;
  let out = template;
  for (const name of Object.keys(params)) out = out.split('{' + name + '}').join(String(params[name]));
  return out;
}

/**
 * Translate one key through the bundle's current binding.
 * @param key - message key.
 * @param params - interpolation values.
 * @returns the translated (or key-fallback) message.
 */
export function t(key, params) {
  const raw = currentTranslate(key, params);
  if (raw === key && params) return interpolate(key, params);
  return raw;
}

/** Point the module-level translator at another binding (test runtime hook). */
export function setTranslate(next) {
  currentTranslate = typeof next === 'function' ? next : (key) => key;
}

/** The translator currently installed (used by the test runtime to restore). */
export function getTranslate() {
  return currentTranslate;
}

/** Merge `{ zh, en }` dictionary parts left-to-right. */
export function mergeDictionaries(...parts) {
  const out = { zh: {}, en: {} };
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if (part.zh && typeof part.zh === 'object') Object.assign(out.zh, part.zh);
    if (part.en && typeof part.en === 'object') Object.assign(out.en, part.en);
  }
  return out;
}

/**
 * The active UI language ("zh" | "en"), for the few date/number formatters that
 * need it. Reads the locale service's current value; a missing service answers
 * "zh", the default of this plugin.
 * @returns the language tag prefix, `'zh'` or `'en'`.
 */
export function lang() {
  try {
    const appCtx = getAppCtx();
    const value = appCtx && appCtx.locale && appCtx.locale.current;
    if (typeof value === 'string' && value.startsWith('en')) return 'en';
    if (typeof value === 'function') {
      const resolved = value();
      if (typeof resolved === 'string' && resolved.startsWith('en')) return 'en';
    }
  } catch { /* default zh */ }
  return 'zh';
}

/**
 * Register one namespace's dictionaries with the locale service and bind `t`.
 *
 * The registration lives on a ctx effect, so a reload of the plugin row
 * releases the namespace with the rest of the bundle.
 *
 * @param ctx - the feature's root context.
 * @param ns - namespace the feature owns (`bw-<feature>`).
 * @param dictionaries - `{ zh, en }` dictionaries to register.
 * @returns the translated binding (`t(key, vars)`).
 */
export function registerLocale(ctx, ns, dictionaries) {
  const dicts = mergeDictionaries(dictionaries);
  const register = () => {
    const dispose = ctx.locale && typeof ctx.locale.register === 'function'
      ? ctx.locale.register(ns, dicts)
      : null;
    if (ctx.locale && typeof ctx.locale.bind === 'function') setTranslate(ctx.locale.bind(ns));
    return () => {
      if (typeof dispose === 'function') dispose();
      else if (dispose && typeof dispose.dispose === 'function') dispose.dispose();
    };
  };
  if (typeof ctx.effect === 'function') {
    ctx.effect(register, ns + ': dictionaries');
  } else {
    register();
  }
  // A ctx without a locale service still translates from the registered dicts.
  if (!ctx.locale || typeof ctx.locale.bind !== 'function') {
    setTranslate((key, params) => interpolate(dicts.zh[key] ?? key, params));
  }
  return t;
}
