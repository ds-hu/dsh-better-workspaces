/**
 * The git data plane client: one SSE-fed snapshot store with polling fallback,
 * the learned-alias table that resolves a Session's subdirectory to the working
 * copy it belongs to, and the localStorage snapshot cache that lets the first
 * paint show the previous visit's answer.
 *
 * Every bundle creates its own feed instance (the four rows are independent
 * browser modules); they share state through localStorage, not through a
 * runtime service.
 */
import { createStore, useStore } from './store.js';
import { API_BASE, apiGet, apiPost } from './api.js';
import { qs, setBoundedClientCache } from './util.js';
import { getFeed } from './runtime.js';

export { setBoundedClientCache };

export const POLL_COALESCE_MS = 250;
// A refusal that names no root to fall back to describes its own row — a
// checkout that no longer exists — never the batch. It is left out of later
// batches for this long, so a row that becomes valid again (the workspace was
// re-registered) recovers on its own without a reload. A refusal that *does*
// name a root is re-keyed instead (see learnGitAlias) and never reaches this
// list.
export const DENIED_RETRY_MS = 60000;
// Learned refusals that name a working copy: one per Session that moved into a
// subdirectory, so a small ceiling is generous.
export const GIT_ALIAS_MAX = 256;
// The host refuses a snapshot batch with more than 200 selectors (413). That
// response carries neither `byCwd` nor `unauthorized`, so an oversized batch
// could not refresh the aliases that made it oversized: one unlucky poll would
// be retried forever with every badge dead. The probe list is clamped to the
// room left after the tracked rows.
export const SNAPSHOT_BATCH_MAX = 200;
// How long a learned answer goes unchecked. Registration is not announced to
// this client, so a path that has since become an authorized root (or moved to
// another working copy) has to be re-asked about — but the answer is only
// *confirmed or replaced*, never dropped on a timer: a row's cwd is the key of
// its open diff page.
export const ALIAS_REVALIDATE_MS = 300000;
// Deferred Workspace recovery: keep asking while a tombstone is outstanding,
// then back off — an idle host has nothing to recover and should not pay one
// authorized read per main checkout every half minute.
export const DEFERRED_RECOVERY_BUSY_MS = 30000;
export const DEFERRED_RECOVERY_IDLE_MS = 300000;

/**
 * Serialize one batch call: at most one in flight, at most one queued rerun, and
 * no dropped caller.
 */
export function createPollScheduler({ send, delayMs = POLL_COALESCE_MS }) {
  let timer = null;
  let inFlight = false;
  let queued = false;
  let disposed = false;

  async function flush() {
    if (disposed) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    try {
      await send();
    } catch { /* transient or disposed */ }
    finally {
      inFlight = false;
      if (queued && !disposed) {
        queued = false;
        schedule(0);
      }
    }
  }

  function schedule(delay) {
    if (disposed) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush(); }, delay);
  }

  return {
    touch() { schedule(delayMs); },
    flush() { schedule(0); },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Remember which selectors the host refused, and for how long. */
export function createDenyList(ttlMs = DENIED_RETRY_MS, now = () => Date.now()) {
  const denied = new Map();
  return {
    mark(cwd) {
      if (typeof cwd !== 'string' || cwd === '') return false;
      const fresh = !denied.has(cwd);
      denied.set(cwd, now());
      return fresh;
    },
    clear(cwd) { denied.delete(cwd); },
    allows(cwd) {
      const at = denied.get(cwd);
      return at === undefined || now() - at >= ttlMs;
    },
    filter(cwds) { return cwds.filter((cwd) => this.allows(cwd)); },
  };
}

/**
 * Remember which working copy a refused selector actually belongs to.
 *
 * Pure: returns the same object when there is nothing to learn, so a store write
 * can be skipped.
 */
export function learnGitAlias(aliases, cwd, root, at = 0, max = GIT_ALIAS_MAX) {
  if (typeof cwd !== 'string' || cwd === '') return aliases;
  if (typeof root !== 'string' || root === '' || root === cwd) return aliases;
  const current = aliases[cwd];
  const next = {};
  let changed = false;
  for (const [key, entry] of Object.entries(aliases)) {
    if (!entry) continue;
    if (entry.root === cwd) {
      next[key] = { root, at };
      changed = true;
    }
    else next[key] = entry;
  }
  if (!current || current.root !== root || current.at !== at) {
    next[cwd] = { root, at };
    changed = true;
  }
  if (!changed) return aliases;
  const keys = Object.keys(next);
  if (keys.length > max) delete next[keys[0]];
  return next;
}

/** Drop the alias keyed by `cwd`: the host answered that path as a selector. */
export function dropGitAlias(aliases, cwd) {
  if (typeof cwd !== 'string' || cwd === '') return aliases;
  if (!Object.prototype.hasOwnProperty.call(aliases, cwd)) return aliases;
  const next = { ...aliases };
  delete next[cwd];
  return next;
}

/** Drop every alias pointing at `target`. */
export function forgetGitAlias(aliases, target) {
  if (typeof target !== 'string' || target === '') return aliases;
  let changed = false;
  const next = {};
  for (const [cwd, entry] of Object.entries(aliases)) {
    if (entry && entry.root === target) changed = true;
    else next[cwd] = entry;
  }
  return changed ? next : aliases;
}

/** Selectors whose alias is due for a check. */
export function staleGitAliases(aliases, now, ttlMs = ALIAS_REVALIDATE_MS) {
  const out = [];
  for (const [cwd, entry] of Object.entries(aliases)) {
    if (!entry || !(now - entry.at < ttlMs)) out.push(cwd);
  }
  return out;
}

/** The selectors one poll batch may carry (probes clamped to the room left). */
export function planSnapshotBatch(tracked, aliases, now, max = SNAPSHOT_BATCH_MAX) {
  const trackedCwds = Object.keys(tracked);
  const due = staleGitAliases(aliases, now).filter((cwd) => !Object.prototype.hasOwnProperty.call(tracked, cwd));
  const probing = due.slice(0, Math.max(0, max - trackedCwds.length));
  return { cwds: [...new Set([...trackedCwds, ...probing])], probing };
}

/** Ahead/behind of one snapshot (null when the host did not know). */
export function syncOf(snapshot) {
  if (snapshot.gitKnown && snapshot.gitKnown.head === false) return { ahead: null, behind: null };
  const originKnown = !snapshot.gitKnown || snapshot.gitKnown.originDelta !== false;
  const ahead = snapshot.upstream ? snapshot.upstream.ahead : originKnown && snapshot.originDelta ? snapshot.originDelta.ahead : null;
  const behind = snapshot.upstream ? snapshot.upstream.behind : originKnown && snapshot.originDelta ? snapshot.originDelta.behind : null;
  return { ahead, behind };
}

/** Whether the working-tree status of this snapshot is actually known. */
export function snapshotMutationKnown(snapshot) {
  return Boolean(snapshot && (!snapshot.gitKnown
    || (snapshot.gitKnown.head !== false && snapshot.gitKnown.status !== false)));
}

/**
 * The directory a row's git state is read from: the Session's own cwd when the
 * host authorizes it, else the working copy the host named as containing it.
 */
export function useGitCwd(rawCwd) {
  const feed = getFeed();
  const alias = useStore(feed.store, (s) => (rawCwd ? s.aliases[rawCwd] : undefined));
  return (alias && alias.root) || rawCwd;
}

/** The same resolution outside a render (forge requests, background work). */
export function gitCwd(rawCwd) {
  const feed = getFeed();
  if (typeof rawCwd !== 'string' || rawCwd === '' || !feed) return rawCwd;
  let alias;
  try { alias = feed.store.get().aliases[rawCwd]; } catch { return rawCwd; }
  return (alias && alias.root) || rawCwd;
}

/* ------------------------------------------------------------------ *
 * persistent snapshot cache (ADR 0018, amendment 1)
 *
 * The last answer per checkout is kept in `localStorage` and hydrated before
 * the first render, so the line paints from the previous visit and the
 * batch/SSE stream corrects it a moment later. Stale-while-revalidate:
 * bounded, versioned, and a corrupt or foreign payload is ignored.
 * ------------------------------------------------------------------ */
export const SNAPSHOT_CACHE_KEY = 'dsh-bw-snapshots-v1';
export const SNAPSHOT_CACHE_VERSION = 1;
export const SNAPSHOT_CACHE_MAX = 120;
export const SNAPSHOT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SNAPSHOT_CACHE_MAX_BYTES = 400 * 1024;
export const SNAPSHOT_CACHE_WRITE_DELAY_MS = 800;

export function snapshotCacheStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
    // jsdom exposes storage on the window object, not as a bare global
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // no DOM storage (Node, privacy modes)
  }
}

/** Hydrate `{ byCwd, aliases }` from the last visit. Never throws. */
export function readSnapshotCache(now = Date.now(), storage = snapshotCacheStorage()) {
  const empty = { byCwd: {}, aliases: {} };
  if (!storage) return empty;
  let raw;
  try { raw = storage.getItem(SNAPSHOT_CACHE_KEY); } catch { return empty; }
  if (!raw) return empty;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return empty; }
  if (!parsed || parsed.version !== SNAPSHOT_CACHE_VERSION) return empty;
  const byCwd = {};
  const snapshots = parsed.snapshots && typeof parsed.snapshots === 'object' ? parsed.snapshots : {};
  const entries = [];
  for (const [cwd, snapshot] of Object.entries(snapshots)) {
    if (typeof cwd !== 'string' || cwd === '') continue;
    if (!snapshot || typeof snapshot !== 'object') continue;
    if (typeof snapshot.isGit !== 'boolean') continue;
    const at = typeof snapshot.at === 'number' && Number.isFinite(snapshot.at) ? snapshot.at : 0;
    // A future timestamp means a different clock (or a hand-edited payload);
    // either way it cannot order against a live answer.
    if (at <= 0 || now - at > SNAPSHOT_CACHE_MAX_AGE_MS || at > now + 60000) continue;
    entries.push([cwd, { ...snapshot, cwd, at }]);
  }
  entries.sort((a, b) => b[1].at - a[1].at);
  for (const [cwd, snapshot] of entries.slice(0, SNAPSHOT_CACHE_MAX)) byCwd[cwd] = snapshot;
  const aliases = {};
  const storedAliases = parsed.aliases && typeof parsed.aliases === 'object' ? parsed.aliases : {};
  for (const [cwd, entry] of Object.entries(storedAliases)) {
    if (typeof cwd !== 'string' || cwd === '' || !entry) continue;
    if (typeof entry.root !== 'string' || entry.root === '' || entry.root === cwd) continue;
    const at = typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : 0;
    // Same window as the snapshots: an old alias can otherwise point a row at
    // a containment root from a previous visit forever, and the corrective
    // probe only lands once the host answers a batch.
    if (at <= 0 || now - at > SNAPSHOT_CACHE_MAX_AGE_MS || at > now + 60000) continue;
    aliases[cwd] = { root: entry.root, at };
  }
  return { byCwd, aliases };
}

/** Persist the store's current `{ byCwd, aliases }`. False when unavailable. */
export function writeSnapshotCache(state, now = Date.now(), storage = snapshotCacheStorage()) {
  if (!storage) return false;
  const byCwd = (state && state.byCwd) || {};
  const entries = Object.entries(byCwd)
    .filter(([, snapshot]) => snapshot && typeof snapshot.isGit === 'boolean'
      && typeof snapshot.at === 'number' && Number.isFinite(snapshot.at)
      && now - snapshot.at <= SNAPSHOT_CACHE_MAX_AGE_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, SNAPSHOT_CACHE_MAX);
  const aliases = {};
  const storedAliases = (state && state.aliases) || {};
  for (const [cwd, entry] of Object.entries(storedAliases)) {
    if (!entry || typeof entry.root !== 'string' || entry.root === '' || entry.root === cwd) continue;
    aliases[cwd] = { root: entry.root, at: entry.at };
  }
  let kept = entries;
  for (;;) {
    const snapshots = {};
    for (const [cwd, snapshot] of kept) snapshots[cwd] = snapshot;
    const payload = JSON.stringify({ version: SNAPSHOT_CACHE_VERSION, savedAt: now, snapshots, aliases });
    if (payload.length <= SNAPSHOT_CACHE_MAX_BYTES || kept.length === 0) {
      try { storage.setItem(SNAPSHOT_CACHE_KEY, payload); return true; } catch { return false; }
    }
    // One oversized entry (a huge PR projection) must not cost the whole cache:
    // drop the oldest and try again.
    kept = kept.slice(0, kept.length - 1);
  }
}

/** Cheap change detector so an unchanged store never rewrites storage. */
export function snapshotCacheSignature(state) {
  const byCwd = (state && state.byCwd) || {};
  const aliases = (state && state.aliases) || {};
  const snapshots = Object.keys(byCwd).sort().map((cwd) => cwd + '@' + (byCwd[cwd] && byCwd[cwd].at));
  const learned = Object.keys(aliases).sort().map((cwd) => cwd + '>' + (aliases[cwd] && aliases[cwd].root));
  return snapshots.join('|') + '#' + learned.join('|');
}

/** Create one snapshot store with SSE + polling. */
export function createGitFeed() {
  const hydrated = readSnapshotCache();
  const store = createStore({ byCwd: hydrated.byCwd, tracked: {}, aliases: hydrated.aliases });
  const serialized = new Map();
  let es = null;
  let pollTimer = null;
  let disposed = false;
  const requests = new AbortController();
  const denyList = createDenyList();
  // Persist the last known answer (ADR 0018, amendment 1). Coalesced: one
  // batch that merges twenty rows touches storage once.
  let persistTimer = null;
  let persistedSignature = snapshotCacheSignature(store.get());
  /** Write the current store if it differs from the last successful write. */
  function flushSnapshotCache() {
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    const state = store.get();
    const signature = snapshotCacheSignature(state);
    // Only a successful write may advance the signature, or one transient
    // quota/SecurityError would suppress every retry of the same state.
    if (signature !== persistedSignature && writeSnapshotCache(state)) persistedSignature = signature;
  }
  const unsubscribePersist = store.subscribe(() => {
    if (disposed || persistTimer !== null) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      if (disposed) return;
      flushSnapshotCache();
    }, SNAPSHOT_CACHE_WRITE_DELAY_MS);
  });
  // Closing/reloading the page does not dispose the plugin, and the last answers
  // must survive it (ADR 0018, amendment 1); the synchronous `pagehide` write
  // is the only reliable point for that.
  const onPageHide = () => { if (!disposed) flushSnapshotCache(); };
  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', onPageHide);
    }
  } catch { /* no dom */ }

  function merge(snapshot) {
    if (disposed || !snapshot || typeof snapshot.cwd !== 'string' || !store.get().tracked[snapshot.cwd]) return;
    const current = store.get().byCwd[snapshot.cwd];
    if (current && typeof current.at === 'number' && typeof snapshot.at === 'number' && current.at > snapshot.at) return;
    let key;
    try {
      key = JSON.stringify({ ...snapshot, at: 0 });
    } catch {
      key = String(snapshot.at);
    }
    if (serialized.get(snapshot.cwd) === key) return;
    serialized.set(snapshot.cwd, key);
    store.set((s) => ({ ...s, byCwd: { ...s.byCwd, [snapshot.cwd]: snapshot } }));
  }

  /**
   * One batch. `pending` entries are simply absent from the answer: the host
   * scheduled them, so the store keeps whatever it already had and the SSE
   * frame that lands later is what fills the badge.
   */
  async function postSnapshots(cwds, fresh = false, probing = []) {
    if (cwds.length === 0) return null;
    const body = fresh ? { cwds, fresh: true } : { cwds };
    const result = await apiPost('/snapshots', body, requests.signal);
    if (result && result.ok && result.byCwd) {
      for (const key of Object.keys(result.byCwd)) merge(result.byCwd[key]);
    }
    // A selector that was only *asked about* on a hunch — an alias due for
    // revalidation — came back as an ordinary selector: the path is a working
    // copy of its own now, so the row reads it. A refusal below only refreshes
    // the alias's timestamp, which is why a probe that confirms the old answer
    // changes nothing on screen.
    if (probing.length > 0 && result) {
      const answered = new Set([
        ...Object.keys(result.byCwd || {}),
        ...(Array.isArray(result.pending) ? result.pending : []),
      ]);
      for (const raw of probing) {
        if (!answered.has(raw)) continue;
        store.set((s) => {
          const aliases = dropGitAlias(s.aliases, raw);
          return aliases === s.aliases ? s : { ...s, aliases };
        });
      }
    }
    // A refused selector describes its own row. When the host names the working
    // copy containing it, the row reads that checkout instead of losing its
    // badges; only a refusal with no root to fall back to (the checkout is
    // gone) is suppressed, so the poll stops paying for a path that cannot
    // answer.
    if (result && Array.isArray(result.unauthorized)) {
      for (const entry of result.unauthorized) {
        const cwd = entry && entry.cwd;
        if (typeof cwd !== 'string' || cwd === '') continue;
        const root = entry && entry.enclosingRoot;
        if (typeof root === 'string' && root !== '' && root !== cwd) {
          store.set((s) => {
            const aliases = learnGitAlias(s.aliases, cwd, root, Date.now());
            return aliases === s.aliases ? s : { ...s, aliases };
          });
          continue;
        }
        store.set((s) => {
          const aliases = forgetGitAlias(s.aliases, cwd);
          return aliases === s.aliases ? s : { ...s, aliases };
        });
        if (denyList.mark(cwd)) {
          console.warn('[better-workspaces] no badges for ' + cwd + ': ' + ((entry && entry.error) || 'workspace not authorized'));
        }
      }
    }
    return result;
  }

  const scheduler = createPollScheduler({
    send: () => {
      const state = store.get();
      // Aliases that are due ride along in the same batch. Nothing is removed
      // here: the host's answer decides, so a row whose checkout did not change
      // keeps the key its open diff page is mounted on.
      const { cwds, probing } = planSnapshotBatch(state.tracked, state.aliases, Date.now());
      return postSnapshots(denyList.filter(cwds), false, probing);
    },
  });

  function connect() {
    try {
      es = new EventSource(API_BASE + '/events');
      es.addEventListener('snapshot', (event) => {
        try {
          merge(JSON.parse(event.data));
        } catch { /* malformed frame */ }
      });
    } catch {
      es = null; // polling covers
    }
  }

  connect();
  // A safety net, not the primary path: the host pushes changes over SSE and
  // this batch is answered from cache, so it is cheap by construction.
  pollTimer = setInterval(() => scheduler.flush(), 15000);

  return {
    store,
    track(cwd) {
      if (!cwd) return;
      const count = store.get().tracked[cwd] || 0;
      store.set((s) => ({ ...s, tracked: { ...s.tracked, [cwd]: count + 1 } }));
      if (count === 0) scheduler.touch();
    },
    untrack(cwd) {
      if (!cwd) return;
      store.set((s) => {
        const count = s.tracked[cwd] || 0;
        if (count === 0) return s;
        const tracked = { ...s.tracked };
        if (count === 1) {
          delete tracked[cwd];
          serialized.delete(cwd);
          denyList.clear(cwd);
          // Keep `byCwd[cwd]`: it is the last known answer for this checkout,
          // and persisting it is the whole point of the cache.
          return { ...s, tracked };
        }
        tracked[cwd] = count - 1;
        return { ...s, tracked };
      });
    },
    refresh(cwd) {
      // An explicit refresh is the one caller that wants to wait for the
      // recompute: `fresh` keeps the request on the server until the snapshot
      // is current, instead of answering from cache.
      if (cwd) postSnapshots([cwd], true).catch(() => {});
      else scheduler.flush();
    },
    dispose() {
      disposed = true;
      requests.abort();
      scheduler.dispose();
      try { if (es) es.close(); } catch { /* ignore */ }
      if (pollTimer) clearInterval(pollTimer);
      try {
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('pagehide', onPageHide);
        }
      } catch { /* no dom */ }
      unsubscribePersist();
      // The plugin is going away (HMR, disable): keep what is known for the
      // next visit. `untrack` deliberately leaves `byCwd` intact, so an
      // injector teardown that runs first cannot empty this payload.
      flushSnapshotCache();
    },
  };
}

/**
 * Detect whether a path is a git checkout (cached for ten seconds).
 * @param path - working directory.
 * @param signal - optional abort signal.
 * @returns `{ ok, isGit, ... }` detection result.
 */
const detectCache = new Map();
export async function detectPath(path, signal) {
  const hit = detectCache.get(path);
  if (hit && Date.now() - hit.at < 10000) return hit.value;
  let value;
  try {
    value = await apiGet('/detect' + qs({ path }), signal);
  } catch (error) {
    if (signal && signal.aborted) throw error;
    value = { ok: false, isGit: false };
  }
  if (!(signal && signal.aborted)) setBoundedClientCache(detectCache, path, { at: Date.now(), value });
  return value;
}

/** Drop the detection cache (apply teardown). */
export function clearDetectCache() {
  detectCache.clear();
}
