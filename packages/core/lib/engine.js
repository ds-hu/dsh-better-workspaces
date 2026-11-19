/**
 * engine.js — the process-wide runtime every feature row leases.
 *
 * 0.3.x shipped exactly one Loader row, so its `apply()` could own the git
 * state hub, the authorizer, the mutation coordinator, the single
 * `webServer.register(api.route)` prefix route and the maintenance lifecycle
 * directly. 0.4.0 ships four rows that switch independently, but the facts
 * those rows share must still exist **once per Cordis root**: one prefix route
 * (a second one is a duplicate-route boot failure) and one hub (two hubs would
 * poll the same repositories twice and broadcast two snapshot streams).
 *
 * The runtime is keyed by `ctx.root`, so rows mounted into one application
 * share it and a row mounted into another root (a test, a second profile) gets
 * its own. Each `acquireRuntime()` adds one reference; the matching
 * `handle.release()` is idempotent, and the last release tears everything down:
 * the prefix route is unregistered, then the API, the hub and the lifecycle.
 *
 * Route groups (docs/ARCHITECTURE-modules.md §5): the `data` group is always
 * enabled while the runtime lives; every other group is enabled only while a
 * row holds a claim on it. A request to a disabled group answers
 * `404 {"ok":false,"error":"feature module disabled"}` in `api.js` before any
 * authorization or read work.
 */
import { join } from 'node:path';
import { API_GROUPS, createApi } from './api.js';
import { createCleanup } from './cleanup.js';
import {
  configureWorktreesBaseDir,
  defaultWorktreesRoot,
  managedWorktreesUnder,
  validateManagedCheckout,
} from './worktree.js';
import { createGitStateHub } from './state.js';
import { detectRepoCached } from './discovery.js';
import { createWorkspaceAuthorizer } from './authorize.js';
import { hostMutationCoordinator } from './mutation.js';
import { samePath } from './stable.js';
import {
  assertWorkspaceArchivable,
  createCreationSourceGuard,
  deleteWorkspace,
  readWorktreesDirConfig,
} from './index.js';

/** One runtime per Cordis root context: `ctx.root` → runtime. */
const runtimes = new WeakMap();

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

/**
 * Lease the runtime of `ctx`'s root. The first caller creates it (and therefore
 * carries the authoritative row config); later callers join it. Throws — before
 * taking a lease — on an invalid or conflicting `worktreesDir`, and rethrows a
 * `webServer.register` failure after cleaning up the half-created runtime.
 *
 * The returned handle is a lease, not the mutable runtime: releasing it twice
 * is a no-op, and releasing one handle never touches the others.
 *
 * @param ctx - the feature row's Cordis context.
 * @param config - the row's raw plugin config (`{ worktreesDir? }` or absent).
 * @returns a leased runtime handle.
 */
export function acquireRuntime(ctx, config) {
  const root = ctx?.root;
  if (!root || typeof root !== 'object') {
    throw new Error('better-workspaces: acquireRuntime requires a Cordis context (ctx.root)');
  }
  let runtime = runtimes.get(root);
  if (runtime) {
    // A later row may repeat the same `worktreesDir` (harmless) but may not
    // disagree with the value the first supplying row fixed.
    runtime.adoptConfig(config);
  } else {
    runtime = createRuntime(ctx, root, config);
    runtimes.set(root, runtime);
  }
  return runtime.lease();
}

/** @returns an internal runtime: `lease()`, `adoptConfig()` and `claim()` are used by {@link acquireRuntime}. */
function createRuntime(ctx, root, config) {
  const lifecycle = new AbortController();
  const registry = ctx.get('workspaceRegistry');
  const mutations = hostMutationCoordinator;
  const workspaceRows = () => registry.list();
  const workspaceRoots = () => workspaceRows().map((workspace) => workspace.path);
  const removeWorkspace = deleteWorkspace.bind(null, registry);
  const authorizer = createWorkspaceAuthorizer({ workspaceRoots });
  const assertCreationSource = createCreationSourceGuard(ctx);
  const createWorkspace = (path, title) => registry.create(path, title);

  // The base directory must be settled before anything captures a path derived
  // from it (ADR 0017). One root has one base: the first row that supplies a
  // non-null value fixes it, and a later row that disagrees is a mount error,
  // never a silent coin toss. A row without the key contributes nothing — it
  // may mount before the row that carries the config.
  let configuredDir = readWorktreesDirConfig(config);
  configureWorktreesBaseDir(configuredDir);
  let configLatched = configuredDir !== null;
  if (configLatched && !samePath(configuredDir, defaultWorktreesRoot())) {
    // Fire-and-forget on purpose: a diagnostic must never delay or fail the
    // mount, and a large previous base should not block boot.
    void warnStrandedManagedWorktrees(ctx, configuredDir).catch(() => {});
  }
  const adoptConfig = (nextConfig) => {
    const dir = readWorktreesDirConfig(nextConfig);
    if (dir === null) return;
    if (configLatched) {
      if (dir !== configuredDir) {
        throw new Error(
          `better-workspaces: worktreesDir config conflict (${JSON.stringify(configuredDir)} vs `
          + `${JSON.stringify(dir)}); write worktreesDir on exactly one feature row`,
        );
      }
      return;
    }
    // The rows mounted so far supplied no base; nothing has derived a path from
    // it yet (every consumer reads the module-level override lazily), so the
    // first row that does supply it fixes it here.
    configuredDir = dir;
    configLatched = true;
    configureWorktreesBaseDir(dir);
    if (!samePath(dir, defaultWorktreesRoot())) {
      void warnStrandedManagedWorktrees(ctx, dir).catch(() => {});
    }
  };

  // Route-group ownership: `data` is the always-on read plane; every other
  // group exists only while at least one lease claims it. Counts rather than a
  // Boolean keep two rows claiming the same group correct (the second release
  // must not disable the first row's routes).
  const enabledGroups = new Set(['data']);
  const groupClaims = new Map();
  const claim = (groups = []) => {
    const requested = Array.isArray(groups) ? groups : [groups];
    for (const group of requested) {
      if (typeof group !== 'string' || !Object.hasOwn(API_GROUPS, group)) {
        throw new Error(
          `better-workspaces: unknown route group ${JSON.stringify(group)}; `
          + `known groups: ${Object.keys(API_GROUPS).join(', ')}`,
        );
      }
    }
    const added = [];
    for (const group of requested) {
      // The data plane cannot be disabled by a claim's release.
      if (group === 'data') continue;
      const count = groupClaims.get(group) ?? 0;
      groupClaims.set(group, count + 1);
      enabledGroups.add(group);
      added.push(group);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const group of added) {
        const count = (groupClaims.get(group) ?? 1) - 1;
        if (count > 0) {
          groupClaims.set(group, count);
          continue;
        }
        groupClaims.delete(group);
        enabledGroups.delete(group);
      }
    };
  };

  let broadcast = null;
  const hub = createGitStateHub({
    mutations,
    authorizeTarget: (cwd) => authorizer.authorize(cwd),
    onChange: (snapshot) => {
      if (broadcast) broadcast(snapshot);
    },
  });

  // Boot/hourly jobs replay durable recovery records only. Destructive
  // abandoned cleanup stays explicit until Session exposes an atomic lease.
  const cleanup = createCleanup(ctx, {
    mutations,
    signal: lifecycle.signal,
    recoveryOnly: true,
    deleteWorkspace: removeWorkspace,
  });

  // workspace rows whose path is a managed worktree (sidebar icon injector)
  const worktreeWorkspaces = async () => {
    if (!registry || typeof registry.list !== 'function') return [];
    const items = [];
    for (const ws of registry.list()) {
      const path = ws && ws.path;
      if (typeof path !== 'string' || path === '') continue;
      // Read route: the cached discovery saves three spawns per row, and the
      // ownership proof inside `validateManagedCheckout` stays live. A drifted
      // checkout keeps its sidebar identity: the branch it is on now is not
      // part of what makes it ours.
      const detected = await detectRepoCached(path).catch(() => null);
      const managed = await validateManagedCheckout(path, detected ? { detected } : {});
      if (managed.ok) items.push({ workspaceId: ws.workspaceId ?? ws.id, path: managed.cwd });
    }
    return items;
  };

  // Agent activity → the one repository family that activity belongs to.
  //
  // This used to call `hub.refreshActive()`, which recomputes every tracked
  // target: twenty workspaces × ~45 spawns is a ~25 s lane load, longer than the
  // 5 s throttle, so while an agent worked the lane never drained and every
  // interactive route queued behind it (ADR 0018). A tool result names one
  // Session; the Session names one cwd; the cwd names one repository family.
  // When any link is missing the throttled full refresh stays as the fallback.
  const sessionsOf = () => {
    const sessions = root.get('sessions');
    return sessions && typeof sessions.list === 'function' ? sessions : null;
  };
  const sessionCwdOf = async (sessionId) => {
    if (typeof sessionId !== 'string' || sessionId === '') return null;
    const sessions = sessionsOf();
    if (!sessions) return null;
    try {
      const snapshot = await sessions.list();
      const summaries = Array.isArray(snapshot)
        ? snapshot
        : Array.isArray(snapshot?.items) ? snapshot.items
          : Array.isArray(snapshot?.ids) && snapshot?.byId ? snapshot.ids.map((id) => snapshot.byId[id]) : [];
      const summary = summaries.find((item) => String(item?.id ?? item?.sessionId ?? '') === sessionId);
      // The header cwd is the original project; a Session that moved into a
      // worktree still resolves to the same repository *family*, which is what
      // `invalidateFamily` needs.
      return summary?.header?.cwd ?? summary?.cwd ?? null;
    } catch {
      return null;
    }
  };
  const refreshSession = (sessionId) => {
    sessionCwdOf(sessionId)
      .then(async (cwd) => {
        if (!cwd) return false;
        return (await hub.invalidateFamily(cwd)) > 0;
      })
      .then((narrowed) => {
        if (!narrowed) hub.refreshActive();
      })
      .catch(() => {});
  };
  // Registered on the root, not on the first row's fiber: the runtime outlives
  // any single row, and disposing one row must not stop snapshot refreshes for
  // the others. They are removed by `destroy()` below.
  const listenerDisposers = [];
  if (typeof root.on === 'function') {
    listenerDisposers.push(root.on('tools/result', (exec) => refreshSession(exec?.agent?.session?.id)));
    listenerDisposers.push(root.on('api-session/status', (sessionId) => refreshSession(sessionId)));
  }

  // The one prefix route. `groups` is a live accessor so claims/disposals are
  // visible per request without rebuilding the router.
  let api = null;
  let unregister = null;
  try {
    const webServer = ctx.get('webServer');
    if (webServer && typeof webServer.register === 'function') {
      api = createApi(hub, {
        cleanup,
        workspaceRoots,
        worktreeWorkspaces,
        workspaceRows,
        createWorkspace,
        assertCreationSource,
        assertWorkspaceArchivable,
        deleteWorkspace: removeWorkspace,
        mutations,
        groups: () => enabledGroups,
      });
      try {
        // The registration failure path must leave no intervals behind: Cordis
        // rolls the row back after `apply()` throws, and the old single-row
        // plugin could rely on its earlier effects for that. Here the runtime
        // is the only owner, so clean up synchronously before rethrowing.
        unregister = webServer.register(api.route);
      } catch (error) {
        const failed = api;
        api = null;
        void failed.dispose();
        throw error;
      }
      broadcast = api.broadcast;
    }
  } catch (error) {
    // The runtime never entered the registry, so no lease exists to dispose it
    // later: undo everything synchronously here, in the reverse order of setup.
    for (const dispose of listenerDisposers.splice(0)) {
      try {
        dispose?.();
      } catch {
        /* the registration failure is the error worth reporting */
      }
    }
    void hub.dispose();
    lifecycle.abort();
    throw error;
  }

  let refs = 0;
  let destroyed = false;

  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    const errors = [];
    // Order: stop the refresh listeners, then the observable edge (the prefix
    // route), then drain the API, then the hub and the lifecycle it shares.
    for (const dispose of listenerDisposers.splice(0)) {
      try {
        dispose?.();
      } catch (error) {
        errors.push(error);
      }
    }
    if (unregister) {
      const detach = unregister;
      unregister = null;
      try {
        detach();
      } catch (error) {
        errors.push(error);
      }
    }
    if (api) {
      const running = api;
      api = null;
      try {
        await running.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await hub.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      lifecycle.abort();
    } catch (error) {
      errors.push(error);
    }
    if (runtimes.get(root) === runtime) runtimes.delete(root);
    if (errors.length > 0) {
      ctx.logger?.warn?.(
        `better-workspaces: runtime teardown reported ${errors.length} error(s): `
        + errors.map((error) => String(error?.message ?? error)).join('; '),
      );
    }
  }

  const runtime = {
    get destroyed() {
      return destroyed;
    },
    adoptConfig,
    claim,
    lease() {
      refs += 1;
      let released = false;
      const claimForLease = (groups) => {
        if (destroyed) return () => {};
        return claim(groups);
      };
      return {
        hub,
        cleanup,
        authorizer,
        workspaceRows,
        workspaceRoots,
        createWorkspace,
        assertCreationSource,
        assertWorkspaceArchivable,
        deleteWorkspace: removeWorkspace,
        mutations,
        /** Claim route groups (`data` excepted: it is always on); returns an idempotent disposer. */
        claim: claimForLease,
        // Docs §4.1 names the same capability "groupsOwner"; keep the alias so
        // a row or a host test can use either spelling.
        groupsOwner: claimForLease,
        release() {
          if (released) return undefined;
          released = true;
          refs -= 1;
          if (refs > 0) return undefined;
          // Delete the map entry before the first await: a row mounting during
          // this teardown must create a fresh runtime, never join a dying one.
          if (runtimes.get(root) === runtime) runtimes.delete(root);
          return destroy();
        },
      };
    },
  };
  return runtime;
}
