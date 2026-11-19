/**
 * Module runtime singletons for one bundle.
 *
 * Every feature bundle is a self-contained browser module: it bundles its own
 * copy of this file, so these singletons describe exactly the runtime of the
 * one feature row that bundle belongs to. `setTestRuntime` is the only way the
 * offline suites install a stand-in app context; it also broadcasts to the
 * other bundles materialized on the same page so one test hook drives them all.
 */
import { setTranslate, getTranslate } from './i18n.js';

/** The feature row's ctx while applied. */
let appCtx = null;
/** The git feed the surfaces of this bundle read snapshots from. */
let feed = null;
/** `uiSession.current` for the on-screen Session, captured in apply. */
let mainViewSessionSource = null;
/** Fenced lifecycle epoch; late async work compares against it. */
let activeLifecycleEpoch = 0;
let lifecycleEpochCounter = 0;

export function getAppCtx() {
  return appCtx;
}

/** Set the feature row's app context for the lifetime of one apply. */
export function setAppCtx(ctx) {
  appCtx = ctx;
}

export function getFeed() {
  return feed;
}

export function setFeed(next) {
  feed = next;
}

export function getLifecycleEpoch() {
  return activeLifecycleEpoch;
}

/** Begin a new plugin lifecycle and fence everything from the previous one. */
export function beginLifecycle() {
  const epoch = ++lifecycleEpochCounter;
  activeLifecycleEpoch = epoch;
  return epoch;
}

export function lifecycleIsActive(epoch) {
  return epoch !== 0 && activeLifecycleEpoch === epoch;
}

/** Tear the lifecycle down: later async work from `epoch` must go inert. */
export function fenceLifecycle(epoch) {
  if (activeLifecycleEpoch === epoch) activeLifecycleEpoch = 0;
}

/** Clear the apply-time session source (teardown or a replaced source). */
export function setMainViewSessionSource(source) {
  mainViewSessionSource = source;
}

export function getMainViewSessionSource() {
  return mainViewSessionSource;
}

/* ------------------------------------------------------------------ */
/* Test runtime: one broadcast registry shared by every bundle instance */
/* ------------------------------------------------------------------ */

/**
 * All bundle copies on the page register their own setter here, so the test
 * suites can drive all four modules (and both materializations of one bundle)
 * through whichever `setTestRuntime` survived the merged `__bwTest`.
 */
const runtimeRegistryKey = '__dshBwTestRuntimeSetters';
function runtimeRegistry() {
  if (typeof window === 'undefined') return [];
  if (!Array.isArray(window[runtimeRegistryKey])) window[runtimeRegistryKey] = [];
  return window[runtimeRegistryKey];
}

function installTestRuntime(ctx, nextFeed, translate) {
  const previous = { appCtx, feed, mainViewSessionSource, translate: getTranslate() };
  appCtx = ctx;
  feed = nextFeed;
  /* Clear the apply-time capture with the context it belongs to: the capture is
     an optimization, never an authority. */
  mainViewSessionSource = null;
  setTranslate(translate || ((key) => key));
  return () => {
    appCtx = previous.appCtx;
    feed = previous.feed;
    mainViewSessionSource = previous.mainViewSessionSource;
    setTranslate(previous.translate);
  };
}

runtimeRegistry().push(installTestRuntime);

/**
 * Install a stand-in runtime on every materialized bundle.
 *
 * @param ctx - the fake app context.
 * @param nextFeed - a feed stand-in (optional).
 * @param translate - the translator the surfaces should use (optional).
 * @returns a restore function for the previous runtime.
 */
export function setTestRuntime(ctx, nextFeed = null, translate = (key) => key) {
  const restores = runtimeRegistry().map((setter) => setter(ctx, nextFeed, translate));
  return () => {
    for (let i = restores.length - 1; i >= 0; i -= 1) {
      try { restores[i](); } catch { /* a torn-down copy must not block the rest */ }
    }
  };
}
