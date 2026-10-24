/**
 * dsh-better-workspaces — host half.
 *
 * Wires the git-state hub to the harness webServer (HTTP + SSE under
 * /better-workspaces/api) and to host activity events so snapshots stay
 * fresh while agents run. `webServer` and the Workspace registry are hard
 * dependencies, so routes cannot race cold boot or mount without their
 * authorization source (ADR 0005, ADR 0010). Optional integrations still
 * degrade gracefully: non-git Workspace → {isGit:false}; no gh CLI → flags.
 */
import { join } from 'node:path';
import { createApi } from './api.js';
import { createCleanup } from './cleanup.js';
import {
  configureWorktreesBaseDir,
  defaultWorktreesRoot,
  managedWorktreesUnder,
  normalizeWorktreesDir,
  validateManagedWorktree,
} from './worktree.js';
import { createGitStateHub } from './state.js';
import { createWorkspaceAuthorizer } from './authorize.js';
import { hostMutationCoordinator } from './mutation.js';
import { samePath } from './stable.js';

export const name = 'better-workspaces';

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

// `webServer` and `workspaceRegistry` are hard dependencies: without the
// first there is no surface; without the second cwd would have no authority
// source. Cordis waits and re-activates after both appear (ADR 0005/0010).
export const inject = ['webServer', 'workspaceRegistry'];

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

/** Config keys the plugin row accepts today. */
const CONFIG_KEYS = ['worktreesDir'];

/**
 * Read the plugin row's `config` (ADR 0017).
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

/**
 * Boot-time warning, never a blocker: after `worktreesDir` changes, the
 * checkouts under the built-in base keep working for diffs, commits and pushes,
 * but they are no longer a managed namespace (no archive, no abandoned sweep)
 * and nothing else would ever say so (ADR 0017).
 */
async function warnStrandedManagedWorktrees(ctx, configured) {
  const previous = defaultWorktreesRoot();
  const stranded = await managedWorktreesUnder(previous);
  if (stranded.length === 0) return;
  ctx.logger?.warn?.(
    `better-workspaces: ${stranded.length} managed worktree(s) are still under ${previous}, `
    + `but worktreesDir is ${configured}; those checkouts keep diffs, commits and pushes, but they `
    + 'are no longer managed (no archive, no abandoned cleanup). Move them under '
    + `${join(configured, '<repoHash>')}/ or point worktreesDir back.`,
  );
}

export function apply(ctx, config = {}) {
  // The base directory must be settled before the hub, cleanup and API capture
  // anything derived from it (ADR 0017).
  const worktreesDir = readWorktreesDirConfig(config);
  configureWorktreesBaseDir(worktreesDir);
  if (worktreesDir && !samePath(worktreesDir, defaultWorktreesRoot())) {
    // Fire-and-forget on purpose: a diagnostic must never delay or fail the
    // mount, and a large previous base should not block boot.
    void warnStrandedManagedWorktrees(ctx, worktreesDir).catch(() => {});
  }
  let broadcast = null;
  const lifecycle = new AbortController();
  const mutations = hostMutationCoordinator;
  const registry = ctx.get('workspaceRegistry');
  const workspaceRows = () => registry.list();
  const deleteWorkspaceFromRegistry = deleteWorkspace.bind(null, registry);
  const workspaceRoots = () => workspaceRows().map((workspace) => workspace.path);
  const authorizer = createWorkspaceAuthorizer({ workspaceRoots });
  const hub = createGitStateHub({
    mutations,
    authorizeTarget: (cwd) => authorizer.authorize(cwd),
    onChange: (snapshot) => {
      if (broadcast) broadcast(snapshot);
    },
  });
  // Register ownership immediately so any later apply failure rolls timers and
  // watchers back with the Cordis fiber.
  ctx.effect(
    () => () => hub.dispose(),
    'better-workspaces: hub',
  );
  ctx.effect(
    () => () => lifecycle.abort(),
    'better-workspaces: lifecycle abort',
  );

  // Boot/hourly jobs replay durable recovery records only. Destructive
  // abandoned cleanup stays explicit until Session exposes an atomic lease.
  const cleanupFn = createCleanup(ctx, {
    mutations,
    signal: lifecycle.signal,
    recoveryOnly: true,
    deleteWorkspace: deleteWorkspaceFromRegistry,
  });
  ctx.effect(
    () => {
      const scheduler = createCleanupScheduler(cleanupFn, {
        signal: lifecycle.signal,
        onStop: () => lifecycle.abort(),
      });
      return () => scheduler.dispose();
    },
    'better-workspaces: abandoned sweep',
  );

  const webServer = ctx.get('webServer');
  if (webServer) {
    // workspace rows whose path is a managed worktree (sidebar icon injector)
    const worktreeWorkspaces = async () => {
      if (!registry || typeof registry.list !== 'function') return [];
      const items = [];
      for (const ws of registry.list()) {
        const path = ws && ws.path;
        if (typeof path !== 'string' || path === '') continue;
        const managed = await validateManagedWorktree(path);
        if (managed.ok) items.push({ workspaceId: ws.workspaceId ?? ws.id, path: managed.cwd });
      }
      return items;
    };
    const api = createApi(hub, {
      cleanup: cleanupFn,
      workspaceRoots,
      worktreeWorkspaces,
      workspaceRows,
      createWorkspace: (path, title) => registry.create(path, title),
      assertCreationSource: createCreationSourceGuard(ctx),
      assertWorkspaceArchivable,
      deleteWorkspace: deleteWorkspaceFromRegistry,
      mutations,
    });
    broadcast = api.broadcast;
    ctx.effect(
      () => {
        let unregister;
        try {
          unregister = webServer.register(api.route);
        } catch (error) {
          api.dispose();
          throw error;
        }
        return async () => {
          unregister();
          await api.dispose();
        };
      },
      'better-workspaces: api routes',
    );
  }

  // Agent activity → throttled recompute of every active target (5 s floor
  // inside the hub; cheap because snapshots are fingerprint-deduped).
  ctx.on('tools/result', () => hub.refreshActive());
  ctx.on('api-session/status', () => hub.refreshActive());

}
