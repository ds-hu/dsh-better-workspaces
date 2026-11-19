/**
 * Workspace service helpers: rename with collision tolerance, mutation leases,
 * deferred deletion recovery and "open or create a Workspace for this path".
 *
 * These are the reads/writes every feature shares; they are in `core` because
 * two or more rows use them (creation, archive, badges identity).
 */
import { getAppCtx, getFeed, getLifecycleEpoch } from './runtime.js';
import { apiGet, apiPost, ownershipError } from './api.js';
import { qs, failureMessage } from './util.js';
import { currentSessionId, normalizeSessionId, openSessionInMainView } from './session.js';
import { DEFERRED_RECOVERY_BUSY_MS, DEFERRED_RECOVERY_IDLE_MS } from './feed.js';

/* rename with the -2 collision fallback; false when both attempts fail.
 * The controller face is positional — rename(workspaceId, title) — and throws
 * RemoteError-shaped failures instead of returning {ok:false} */
function renameErrorCode(e) {
  if (!e) return null;
  return e.code || (e.error && e.error.code) || (e.details && e.details.code) || null;
}

async function renameWorkspaceTolerant(workspaces, lifecycle, workspaceId, title) {
  const live = () => lifecycle !== 0 && getLifecycleEpoch() === lifecycle;
  if (!live()) return false;
  try {
    await workspaces.rename(workspaceId, title);
    return live();
  } catch (e) {
    if (!live() || renameErrorCode(e) !== 'workspace/name-conflict') return false;
    try {
      await workspaces.rename(workspaceId, title + '-2');
      return live();
    } catch {
      return false;
    }
  }
}

const workspaceRenameQueues = new Map();

/** Serialize renames per workspace and always converge on the last title. */
export function queueWorkspaceRename(workspaceId, title) {
  const lifecycle = getLifecycleEpoch();
  const workspaces = getAppCtx().workspaces;
  const queueKey = `${lifecycle}\u0000${workspaceId}`;
  let state = workspaceRenameQueues.get(queueKey);
  if (!state) {
    state = { desired: title, promise: null };
    workspaceRenameQueues.set(queueKey, state);
  } else state.desired = title;
  if (!state.promise) {
    state.promise = (async () => {
      let outcome;
      for (;;) {
        const target = state.desired;
        outcome = await renameWorkspaceTolerant(workspaces, lifecycle, workspaceId, target);
        if (getLifecycleEpoch() !== lifecycle || state.desired === target) return outcome;
      }
    })().finally(() => {
      if (workspaceRenameQueues.get(queueKey) === state) workspaceRenameQueues.delete(queueKey);
    });
  }
  return state.promise;
}

export function workspaceSnapshot() {
  const appCtx = getAppCtx();
  const workspaces = appCtx && appCtx.workspaces;
  if (!workspaces) return { items: [], archivedSessionIds: [] };
  if (workspaces.list && workspaces.list.getSnapshot) {
    return workspaces.list.getSnapshot() || { items: [], archivedSessionIds: [] };
  }
  return { items: workspaces.items || [], archivedSessionIds: workspaces.archivedSessionIds || [] };
}

export function workspaceItems() {
  return workspaceSnapshot().items || [];
}

/* workspaces.create resolves the Workspace object ITSELF (gateway contract,
 * dsh-git-worktree pre-session controller parity). */
const workspaceMutationLeases = new Map();

/** Serialize mutations per checkout; null when one is already in flight. */
export function acquireWorkspaceMutation(cwd) {
  const key = String(cwd || '');
  if (!key || workspaceMutationLeases.has(key)) return null;
  const owner = {};
  workspaceMutationLeases.set(key, owner);
  return () => { if (workspaceMutationLeases.get(key) === owner) workspaceMutationLeases.delete(key); };
}

let deferredRecoveryRunning = false;

/**
 * Workspace rows that are registered main checkouts, taken from the live git
 * feed instead of one `GET /detect` per workspace.
 *
 * `unseen` is the price of reading the feed: at boot the feed is always empty,
 * so a pass that ran before the first batch must not be scored as idle — only a
 * settled feed (every registered path known) may be.
 */
export function deferredRecoveryTargets(items, byCwd) {
  const known = byCwd && typeof byCwd === 'object' ? byCwd : {};
  const candidates = [];
  let unseen = 0;
  for (const workspace of items || []) {
    const path = workspace && workspace.path;
    if (typeof path !== 'string' || path === '') continue;
    const snapshot = known[path];
    if (!snapshot) {
      unseen += 1;
      continue;
    }
    if (snapshot.isGit !== true) continue;
    if (snapshot.isLinkedWorktree || snapshot.mainRepoRoot !== path) continue;
    candidates.push(path);
  }
  return { candidates, unseen };
}

function feedSnapshotByCwd() {
  try {
    const feed = getFeed();
    return (feed && feed.store.get().byCwd) || {};
  } catch { return {}; }
}

/** How long to wait before the next recovery pass. */
export function deferredRecoveryDelay({ outstanding = 0, unseen = 0 } = {}) {
  return outstanding > 0 || unseen > 0 ? DEFERRED_RECOVERY_BUSY_MS : DEFERRED_RECOVERY_IDLE_MS;
}

/** One recovery pass. Returns `{ outstanding, unseen }`, or null when running. */
export async function recoverDeferredWorkspaceDeletions(signal) {
  if (deferredRecoveryRunning || signal?.aborted) return null;
  deferredRecoveryRunning = true;
  const { candidates, unseen } = deferredRecoveryTargets(workspaceItems(), feedSnapshotByCwd());
  let outstanding = 0;
  try {
    for (const mainPath of candidates) {
      if (signal?.aborted) return null;
      let pending;
      try { pending = await apiGet('/worktrees/deferred' + qs({ cwd: mainPath }), signal); } catch { continue; }
      if (!pending || !pending.ok || !Array.isArray(pending.items)) continue;
      outstanding += pending.items.length;
      for (const record of pending.items) {
        if (signal?.aborted || !record || typeof record.workspaceId !== 'string'
          || !Array.isArray(record.sessionIds)) continue;
        const targetWorkspace = workspaceItems().find((item) => item.workspaceId === record.workspaceId);
        if (!targetWorkspace) {
          try { await apiPost('/worktrees/finalize-delete', { cwd: mainPath, token: record.token }, signal); } catch { /* retry later */ }
          continue;
        }
        if (targetWorkspace.path !== record.path) continue;
        const ids = record.sessionIds.map(String);
        const alreadyArchived = new Set((workspaceSnapshot().archivedSessionIds || []).map(String));
        const needsArchive = ids.filter((id) => !alreadyArchived.has(id));
        // Historical journals may predate the retiring-lease policy. Never infer
        // cross-page draft ownership during recovery; only finalize a
        // transaction whose Session retirement is already durable.
        if (needsArchive.length > 0) continue;
        try {
          await apiPost('/worktrees/finalize-delete', { cwd: mainPath, token: record.token }, signal);
        } catch { /* durable record remains for a later pass */ }
      }
    }
    return { outstanding, unseen };
  } finally {
    deferredRecoveryRunning = false;
  }
}

const workspaceOpenFlights = new Map();

/** Open (creating when needed) the Workspace that holds `path`. */
export async function openWorkspaceFor(path, expectedSessionId) {
  const lifecycle = getLifecycleEpoch();
  const appCtx = getAppCtx();
  const workspaces = appCtx.workspaces;
  const sessions = appCtx.sessions;
  const key = path + '\u0000' + (expectedSessionId || '');
  if (workspaceOpenFlights.has(key)) return workspaceOpenFlights.get(key);
  const flight = (async () => {
    const currentStillOwned = () => lifecycle !== 0 && getLifecycleEpoch() === lifecycle
      && (!expectedSessionId || currentSessionId() === expectedSessionId);
    if (!currentStillOwned()) throw ownershipError();
    let workspace = workspaceItems().find((w) => w.path === path);
    if (!workspace) {
      workspace = await workspaces.create({ path });
      if (!workspace || workspace.path !== path) throw new Error(failureMessage(workspace) || 'workspace create failed');
    }
    if (!currentStillOwned()) throw ownershipError();
    const sessionId = normalizeSessionId(await sessions.create({ workspaceId: workspace.workspaceId }));
    if (!sessionId) throw new Error('session create failed');
    if (!currentStillOwned()) {
      try { await workspaces.archiveSession(sessionId); } catch { /* exact unused target */ }
      throw ownershipError();
    }
    openSessionInMainView(sessionId);
    return { sessionId, workspace };
  })();
  workspaceOpenFlights.set(key, flight);
  try { return await flight; }
  finally { if (workspaceOpenFlights.get(key) === flight) workspaceOpenFlights.delete(key); }
}

/** Drop every workspace helper cache (apply teardown). */
export function clearWorkspaceCaches() {
  workspaceRenameQueues.clear();
  workspaceMutationLeases.clear();
  workspaceOpenFlights.clear();
}
