/**
 * dsh-better-workspaces core — the shared library surface.
 *
 * `@ds-hu/dsh-bw-core` is not a Loader row: it declares neither `dsh.bundle`
 * nor `dsh.client`, so the plugin panel can never switch it and no feature row
 * can accidentally unmount it (docs/ARCHITECTURE-modules.md §2). The four
 * feature rows (`bw-diff`, `bw-worktree`, `bw-status`, `bw-forge`) import this
 * package, and the host suites import the same entry points directly.
 *
 * What lives here:
 *   - the scheduler/authorizer/deletion helpers that are pure host policy;
 *   - the config reader every row validates its `worktreesDir` with;
 *   - re-exports of the one router (`api.js`) and the per-root runtime
 *     (`engine.js`) those rows lease.
 *
 * 0.3.x kept `apply`, `name` and `inject` here; they moved to the four feature
 * entries, and the process-wide wiring they created moved to `engine.js`.
 */
import { normalizeWorktreesDir } from './worktree.js';

export { API_GROUPS, API_PREFIX, createApi, groupForPath } from './api.js';
export { acquireRuntime } from './engine.js';

// The only options any caller passes are `start`, `signal` and `onStop`; the
// boot/hourly cadence itself is fixed (5 s settle, then hourly replay).
export function createCleanupScheduler(cleanupFn, options = {}) {
  let stopped = false;
  let sweeping = null;
  const sweep = () => {
    if (stopped || sweeping) return sweeping;
    sweeping = Promise.resolve(cleanupFn({ abandoned: true, automatic: true, signal: options.signal }))
      .catch(() => {})
      .finally(() => { sweeping = null; });
    return sweeping;
  };
  const boot = options.start === false ? null : setTimeout(sweep, 5000);
  const hourly = options.start === false ? null : setInterval(sweep, 60 * 60 * 1000);
  return {
    sweep,
    async dispose() {
      if (!stopped) {
        stopped = true;
        options.onStop?.();
        if (boot !== null) clearTimeout(boot);
        if (hourly !== null) clearInterval(hourly);
      }
      await sweeping;
    },
  };
}

export function createCreationSourceGuard(ctx) {
  return async (sourceSessionId, expectedCwd) => {
    const sessions = ctx.get('sessions');
    if (!sessions || typeof sessions.list !== 'function') {
      throw new Error('creation source session is unavailable');
    }
    const snapshot = await sessions.list();
    const summaries = Array.isArray(snapshot)
      ? snapshot
      : Array.isArray(snapshot?.items) ? snapshot.items
        : Array.isArray(snapshot?.ids) && snapshot?.byId ? snapshot.ids.map((id) => snapshot.byId[id]) : null;
    if (!summaries) throw new Error('creation source session is unreadable');
    const source = summaries.find((item) => String(item?.id ?? item?.sessionId ?? '') === sourceSessionId);
    const cwd = source?.header?.cwd ?? source?.cwd;
    if (cwd !== expectedCwd) throw new Error('creation source session no longer owns cwd');
  };
}

// DSH currently has no lease shared by Workspace membership, Session create,
// Agent wake and browser draft ownership. Snapshot checks cannot make
// physical deletion safe, including for unregistered managed worktrees.
export async function assertWorkspaceArchivable() {
  throw new Error('physical archive is disabled until DSH provides a Session/Agent retiring lease');
}

// DSH 0.1.x exposed a public `registry.archivedSessionIds` array, so this
// guard could enumerate the archive set. DSH 0.2.0 keeps that set in the
// registry's private state and publishes only per-session writes
// (`archiveSession` / `unarchiveSession` / `pinSession`), so no public read
// of "which sessions are archived" exists any more. Reading a private field
// would be a fabricated capability test, so the guard verifies the
// preconditions it can prove (target identity, captured membership) and
// then refuses.
//
// A pre-policy tombstone may omit a Session attached after its snapshot,
// while WorkspaceEntity.sessionIds hides dead-cwd durable members after
// physical removal. Without a raw-membership/retiring lease, retaining the
// exact row is the only provably safe outcome. An already-absent row
// remains idempotently completable.
export async function deleteWorkspace(registry, workspaceId, expectedPath, capturedSessionIds) {
  const target = registry.list().find((workspace) => (workspace.workspaceId ?? workspace.id) === workspaceId);
  if (!target) return false;
  if (target.path !== expectedPath) throw new Error('workspace deletion target no longer matches the archived path');
  if (!Array.isArray(capturedSessionIds)) {
    throw new Error('workspace deletion refused without captured durable Session membership');
  }
  throw new Error('workspace deletion is disabled until raw durable membership can be proven');
}

/** Config keys the feature rows accept today. */
const CONFIG_KEYS = ['worktreesDir'];

/**
 * Read one feature row's `config` (ADR 0017).
 *
 * All four rows accept the same optional object, so the key may be written on
 * any single row (recommended: `bw-worktree`); `engine.js` fixes the first
 * non-null value for the whole root and refuses disagreement.
 *
 * Unknown keys are refused rather than ignored: `worktreeDir` / `baseDir` are
 * exactly the spellings a user is likely to guess, and silently ignoring one
 * would move every future worktree to a directory the user did not choose.
 *
 * @param config - the row's raw config as composed from the profile yml.
 * @returns the normalized base directory, or `null` when unset.
 */
export function readWorktreesDirConfig(config) {
  if (config === undefined || config === null) return null;
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('worktree: plugin config must be an object with a worktreesDir key');
  }
  const unknown = Object.keys(config).filter((key) => !CONFIG_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(
      `worktree: unknown plugin config key ${unknown.map((key) => JSON.stringify(key)).join(', ')}; `
      + `accepted keys: ${CONFIG_KEYS.join(', ')}`,
    );
  }
  return normalizeWorktreesDir(config.worktreesDir);
}
