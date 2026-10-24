/**
 * state.js — the git-state hub (paseo's workspace-git-service, miniature).
 *
 * Per target cwd we keep a folded snapshot (branch, dirty, ahead/behind,
 * upstream, diffStat, PR + checks, forge auth). Freshness:
 *   - fs watchers on the working tree (1 s debounce) and the git dir refs;
 *     watcher failure degrades to 5 s polling (paseo's fallback);
 *   - background `git fetch origin --prune` every 180 s per repo;
 *   - PR/checks adaptive poll: 20 s while checks pending, 120 s idle,
 *     exponential error backoff capped at 300 s, batched ≤20 per gh call;
 *   - fingerprint dedupe: identical snapshots are never re-emitted.
 * Targets not accessed for 3 minutes are pruned (watchers closed).
 */
import { constants, watch } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import {
  aheadBehind,
  currentBranchInfo,
  diffStat,
  originBranchDelta,
  originUrl,
  remoteUrl,
  porcelainStatus,
  resolveBestComparisonBaseRef,
  resolveDefaultBranch,
  runGit,
  statusProbe,
  upstreamInfo,
  withBackgroundGitLane,
  withPinnedGitEnvironment,
  withGitAbortSignal,
  withoutPinnedGitEnvironment,
} from './git.js';
import { detectRepoCached } from './discovery.js';
import { readMetadata, validateManagedWorktree, mainRepoRootOf } from './worktree.js';
import { isDirfdPinSupported, procFdPath, verifyStatIdentity, verifyStatIdentityFields } from './stable.js';
import { forgeRepositoryKey, ghAuthenticated, ghAvailable, parseGithubRemote, prStatusBatch } from './forge.js';
import { hostMutationCoordinator } from './mutation.js';

const SNAPSHOT_FRESH_MS = 3000;
const WATCH_DEBOUNCE_MS = 1000;
const MIN_COMPUTE_GAP_MS = 2000;
const TARGET_TTL_MS = 180000;
const FETCH_INTERVAL_MS = 180000;
const INITIAL_FETCH_DELAY_MS = 10000;
const MAX_FETCHES_PER_TICK = 2;
const FETCH_TIMEOUT_MS = 30000;
const TICK_MS = 5000;
const PR_PENDING_MS = 20000;
const PR_IDLE_MS = 120000;
const PR_BACKOFF_CAP_MS = 300000;
const NEGATIVE_TTL_MS = 30000;
const MAX_NEGATIVE_ENTRIES = 512;
// Repository-level facts that only change when a human edits a branch or a
// remote — never on a watcher tick. Ref-derived facts carry a shorter TTL and
// are dropped as soon as a fetch completes.
const REPO_FACT_TTL_MS = 300000;
const BASE_REF_TTL_MS = 60000;
// A watcher that failed degrades to polling. The first retry stays quick because
// a transient failure is common; repeated ones back off, because a host with
// twenty degraded targets would otherwise spawn a compute per target every 5 s.
const DEGRADED_BACKOFF_MS = [5000, 15000, 30000];
// Watchers are the primary signal; this is the net for the events they miss
// (a silently dropped recursive watch on Windows is not observable).
const BACKGROUND_SWEEP_MS = 60000;
const BACKGROUND_SWEEP_MAX_TARGETS = 4;

function validPullProvenance(metadata) {
  return Boolean(metadata?.intent === 'pr-checkout'
    && Number.isSafeInteger(metadata.pullNumber) && metadata.pullNumber > 0
    && typeof metadata.pullHeadRef === 'string' && metadata.pullHeadRef.length > 0 && metadata.pullHeadRef.length <= 1024
    // eslint-disable-next-line no-control-regex -- unsafe Git ref bytes
    && !/[\u0000-\u001f\u007f]/.test(metadata.pullHeadRef)
    && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(metadata.prHeadSha || '')
    && forgeRepositoryKey({ host: metadata.pullHost, owner: metadata.pullOwner, repo: metadata.pullRepo }));
}

function prSelectorKey(value) {
  const { github, prNumber, prHeadRef, branch, prLookupSha, sha, prPollingDisabled } = value || {};
  if (!github || prPollingDisabled) return null;
  return JSON.stringify([
    forgeRepositoryKey(github),
    Number.isSafeInteger(prNumber) ? prNumber : null,
    prHeadRef || branch || null,
    prLookupSha || sha || null,
  ]);
}
const FULL_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

function safeBaseName(value) {
  if (typeof value !== 'string' || value === '' || value.startsWith('-') || value.includes('..') || value.includes('@{')) return null;
  // eslint-disable-next-line no-control-regex -- unsafe Git ref/revision bytes
  return /[\s~^:?*[\]\\\u0000-\u001f\u007f]/.test(value) ? null : value;
}

export function createGitStateHub({ onChange, mutations = hostMutationCoordinator, authorizeTarget } = {}) {
  const targets = new Map(); // cwd → target
  const negatives = new Map(); // non-git path → checkedAt
  const repos = new Map(); // mainRoot → { cwds:Set, nextFetchAt, fetching }
  // Per-repository facts, keyed `${mainRoot}\0<name>`. `defaultBranch` and
  // `originUrl` only change when a human edits a branch or a remote; a
  // comparison ref moves whenever a fetch lands, hence the shorter TTL. Both
  // are dropped on a completed fetch and on any explicit invalidation.
  const facts = new Map(); // `${mainRoot}\0<name>` → { at, value }
  const repositoryFact = async (mainRoot, name, ttlMs, read) => {
    const key = `${mainRoot}\u0000${name}`;
    const hit = facts.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await read();
    facts.set(key, { at: Date.now(), value });
    return value;
  };
  const dropFacts = (mainRoot) => {
    const prefix = `${mainRoot}\u0000`;
    for (const key of [...facts.keys()]) if (key.startsWith(prefix)) facts.delete(key);
  };
  const headFromProbe = (probe) => ({
    ok: true,
    branch: probe.branch,
    detached: probe.detached,
    detachedShort: probe.detachedShort,
    sha: probe.sha,
    unborn: probe.unborn,
  });
  const statusFromProbe = (probe) => ({ ok: true, dirty: probe.dirty, entries: probe.entries });
  const rememberNegative = (cwd) => {
    negatives.delete(cwd);
    negatives.set(cwd, Date.now());
    while (negatives.size > MAX_NEGATIVE_ENTRIES) negatives.delete(negatives.keys().next().value);
  };
  const emit = (snapshot) => {
    if (disposed || typeof onChange !== 'function') return;
    try {
      onChange(snapshot);
    } catch {
      /* listener faults must not break the hub */
    }
  };

  let disposed = false;
  let epoch = 0;
  const lifecycle = new AbortController();
  const inflight = new Set();
  const isLive = (target, token) => !disposed
    && token === epoch
    && !target.disposed
    && targets.get(target.cwd) === target;
  const reauthorize = async (target, token) => {
    if (!isLive(target, token)) return null;
    if (typeof authorizeTarget !== 'function') return { cwd: target.cwd, identity: target.capability };
    const current = await authorizeTarget(target.cwd);
    if (!isLive(target, token)
      || !current?.ok
      || current.gitBoundary !== 'root'
      || current.cwd !== target.cwd
      || current.mainRepoRoot !== target.mainRoot
      || current.gitDir !== target.capability?.gitDir
      || current.gitCommonDir !== target.capability?.gitCommonDir
      || current.gitDirIdentity?.dev !== target.capability?.gitDirDev
      || current.gitDirIdentity?.ino !== target.capability?.gitDirIno
      || current.gitCommonIdentity?.dev !== target.capability?.gitCommonDev
      || current.gitCommonIdentity?.ino !== target.capability?.gitCommonIno
      || current.identity?.dev !== target.capability?.dev
      || current.identity?.ino !== target.capability?.ino
      || current.mainIdentity?.dev !== target.capability?.mainDev
      || current.mainIdentity?.ino !== target.capability?.mainIno) {
      if (isLive(target, token)) disposeTarget(target);
      return null;
    }
    return current;
  };
  const track = (promise) => {
    inflight.add(promise);
    promise.then(
      () => inflight.delete(promise),
      () => inflight.delete(promise),
    );
    return promise;
  };

  /* ---------------- target lifecycle ---------------- */

  async function ensureTarget(cwd) {
    if (disposed || !cwd) return null;
    const existing = targets.get(cwd);
    if (existing) {
      if (typeof authorizeTarget === 'function') {
        const token = epoch;
        const current = await authorizeTarget(cwd);
        if (disposed || token !== epoch || existing.disposed || targets.get(cwd) !== existing) return null;
        if (!current?.ok
          || current.gitBoundary !== 'root'
          || current.cwd !== cwd
          || current.mainRepoRoot !== existing.mainRoot
          || current.gitDir !== existing.capability?.gitDir
          || current.gitCommonDir !== existing.capability?.gitCommonDir
          || current.gitDirIdentity?.dev !== existing.capability?.gitDirDev
          || current.gitDirIdentity?.ino !== existing.capability?.gitDirIno
          || current.gitCommonIdentity?.dev !== existing.capability?.gitCommonDev
          || current.gitCommonIdentity?.ino !== existing.capability?.gitCommonIno
          || current.identity?.dev !== existing.capability?.dev
          || current.identity?.ino !== existing.capability?.ino
          || current.mainIdentity?.dev !== existing.capability?.mainDev
          || current.mainIdentity?.ino !== existing.capability?.mainIno) {
          disposeTarget(existing);
          return null;
        }
      }
      existing.lastAccess = Date.now();
      return existing;
    }
    const neg = negatives.get(cwd);
    if (neg && Date.now() - neg < NEGATIVE_TTL_MS) return null;
    const token = epoch;
    const capability = typeof authorizeTarget === 'function' ? await authorizeTarget(cwd) : null;
    if (disposed || token !== epoch) return null;
    if (typeof authorizeTarget === 'function'
      && (!capability?.ok || capability.gitBoundary !== 'root' || capability.cwd !== cwd)) return null;
    // Read path: the cached discovery is what makes a repeat authorization free
    // (ADR 0013 Amendment 1). The identity facts it does not carry are verified
    // immediately below, and again inside every compute.
    const detect = await detectRepoCached(cwd);
    if (disposed || token !== epoch) return null;
    if (typeof authorizeTarget === 'function') {
      const confirmed = await authorizeTarget(cwd);
      if (disposed || token !== epoch
        || !confirmed?.ok
        || confirmed.gitBoundary !== 'root'
        || confirmed.mainRepoRoot !== capability.mainRepoRoot
        || confirmed.gitDir !== capability.gitDir
        || confirmed.gitCommonDir !== capability.gitCommonDir
        || confirmed.gitDirIdentity?.dev !== capability.gitDirIdentity?.dev
        || confirmed.gitDirIdentity?.ino !== capability.gitDirIdentity?.ino
        || confirmed.gitCommonIdentity?.dev !== capability.gitCommonIdentity?.dev
        || confirmed.gitCommonIdentity?.ino !== capability.gitCommonIdentity?.ino
        || confirmed.identity?.dev !== capability.identity?.dev
        || confirmed.identity?.ino !== capability.identity?.ino
        || confirmed.mainIdentity?.dev !== capability.mainIdentity?.dev
        || confirmed.mainIdentity?.ino !== capability.mainIdentity?.ino) return null;
    }
    const raced = targets.get(cwd);
    if (raced) {
      raced.lastAccess = Date.now();
      return raced;
    }
    if (!detect.isGit
      || (capability && capability.mainRepoRoot !== detect.mainRepoRoot)) {
      rememberNegative(cwd);
      return null;
    }
    const target = {
      cwd,
      repoRoot: detect.repoRoot,
      mainRoot: detect.mainRepoRoot,
      gitCommonDir: detect.gitCommonDir,
      gitDir: detect.gitDir,
      isLinkedWorktree: detect.isLinkedWorktree,
      capability: capability ? {
        mainRepoRoot: capability.mainRepoRoot,
        gitDir: capability.gitDir,
        gitCommonDir: capability.gitCommonDir,
        gitDirDev: capability.gitDirIdentity?.dev,
        gitDirIno: capability.gitDirIdentity?.ino,
        gitCommonDev: capability.gitCommonIdentity?.dev,
        gitCommonIno: capability.gitCommonIdentity?.ino,
        dev: capability.identity?.dev,
        ino: capability.identity?.ino,
        mainDev: capability.mainIdentity?.dev,
        mainIno: capability.mainIdentity?.ino,
      } : null,
      lastAccess: Date.now(),
      lastComputeAt: 0,
      snapshot: null,
      fingerprint: null,
      computing: null,
      recomputeAfterCurrent: false,
      debounceTimer: null,
      watchers: [],
      degradedTimer: null,
      nextPrAt: 0,
      prBackoffMs: 0,
      disposed: false,
    };
    targets.set(cwd, target);
    let repo = repos.get(target.mainRoot);
    if (!repo) {
      repo = { cwds: new Set(), nextFetchAt: 0, fetching: false, hasOrigin: null };
      repos.set(target.mainRoot, repo);
    }
    repo.cwds.add(cwd);
    startWatchers(target);
    scheduleCompute(target, 0, true); // initial compute ASAP
    // Not 0: the first fetch of a repository is network-bound and nobody is
    // waiting for it at page load, so it waits out the first paint and the
    // first snapshot batch (the shape that made a cold start take minutes).
    scheduleFetch(target.mainRoot, INITIAL_FETCH_DELAY_MS);
    return target;
  }

  function disposeTarget(target) {
    target.disposed = true;
    for (const w of target.watchers) {
      try {
        w.close();
      } catch {
        /* already dead */
      }
    }
    target.watchers = [];
    if (target.degradedTimer) clearTimeout(target.degradedTimer);
    if (target.debounceTimer) clearTimeout(target.debounceTimer);
    const repo = repos.get(target.mainRoot);
    if (repo) {
      repo.cwds.delete(target.cwd);
      if (repo.cwds.size === 0) repos.delete(target.mainRoot);
    }
    targets.delete(target.cwd);
  }

  /* ---------------- watchers ---------------- */

  function startWatchers(target) {
    const schedule = () => {
      // ref echoes during our own fetch are fine — debounce absorbs them
      scheduleCompute(target, WATCH_DEBOUNCE_MS, true);
    };
    const attach = (path, opts) => {
      try {
        const w = watch(path, opts, () => schedule());
        w.on('error', () => degrade(target));
        target.watchers.push(w);
        return true;
      } catch {
        return false;
      }
    };
    const worktreeOk = attach(target.repoRoot, { recursive: true });
    let gitStateOk = true;
    if (target.gitCommonDir) {
      const refsOk = attach(join(target.gitCommonDir, 'refs'), { recursive: true });
      const commonOk = attach(target.gitCommonDir, { recursive: false }); // packed-refs + worktrees metadata
      gitStateOk = refsOk && commonOk;
    }
    // A partial watcher set is not sufficient: missing either worktree content
    // or Git refs can leave a stale snapshot forever. Poll the whole target.
    if (!worktreeOk || !gitStateOk) degrade(target);
  }

  function degrade(target) {
    for (const w of target.watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    target.watchers = [];
    if (target.degradedTimer || target.disposed) return;
    let step = 0;
    const arm = () => {
      const delay = DEGRADED_BACKOFF_MS[Math.min(step, DEGRADED_BACKOFF_MS.length - 1)];
      step += 1;
      target.degradedTimer = setTimeout(() => {
        target.degradedTimer = null;
        if (target.disposed || disposed) return;
        scheduleCompute(target, 0, true);
        arm();
      }, delay);
    };
    arm();
  }

  /* ---------------- compute ---------------- */

  // A watcher tick, a fetch, a periodic poll, or a snapshot read that nobody is
  // waiting on all run in the background lane. Foreground is reserved for work
  // an HTTP response is blocked on — a `{ fresh: true }` read, `/actions`, or an
  // invalidation after a mutation the user performed (lane.js, ADR 0018). The
  // classification follows the caller, never the operation: the same compute is
  // background when a badge wave kicked it and foreground when a click awaits it.
  const withGitLaneOf = (background, task) => (background ? withBackgroundGitLane(task) : task());

  function scheduleCompute(target, delayMs, force) {
    if (target.disposed || disposed) return;
    if (target.debounceTimer) clearTimeout(target.debounceTimer);
    const run = () => {
      target.debounceTimer = null;
      computeTarget(target, force).catch(() => {
        /* compute failures are recoverable; next tick retries */
      });
    };
    if (delayMs > 0) target.debounceTimer = setTimeout(run, delayMs);
    else run();
  }

  async function computeTarget(target, force = false, queueIfBusy = force, background = true) {
    if (target.disposed || disposed) return target.snapshot;
    if (!force && target.snapshot && Date.now() - target.lastComputeAt < MIN_COMPUTE_GAP_MS) {
      return target.snapshot;
    }
    if (target.computing) {
      if (force && queueIfBusy) target.recomputeAfterCurrent = true;
      return target.computing;
    }
    const token = epoch;
    // The scope covers the compute and the re-authorization inside it. The
    // authorization that *creates* the target happens earlier, in `ensureTarget`,
    // and is classified by `snapshotFor` — wrapping the compute alone left the
    // spawns of a first-sight target on the wrong side of the split.
    const promise = withGitLaneOf(background, async () => {
      const authorized = await reauthorize(target, token);
      if (!authorized) return null;
      let directory = null;
      let mainDirectory = null;
      let gitDirectory = null;
      let commonDirectory = null;
      try {
        let cwd = target.cwd;
        if (typeof authorizeTarget === 'function' && isDirfdPinSupported()) {
          directory = await open(target.cwd, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          const identity = await directory.stat();
          if (identity.dev !== authorized.identity?.dev || identity.ino !== authorized.identity?.ino) {
            disposeTarget(target);
            return null;
          }
          if (authorized.mainRepoRoot && authorized.mainRepoRoot !== authorized.cwd) {
            mainDirectory = await open(authorized.mainRepoRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
            const mainIdentity = await mainDirectory.stat();
            if (mainIdentity.dev !== authorized.mainIdentity?.dev || mainIdentity.ino !== authorized.mainIdentity?.ino) {
              disposeTarget(target);
              return null;
            }
          }
          cwd = procFdPath(directory);
        } else if (typeof authorizeTarget === 'function') {
          // Path mode (paseo model): the canonical cwd is the anchor and stat
          // identity is the proof; Git discovers from the working tree.
          const gitDirOk = await verifyStatIdentityFields(target.gitDir, target.capability?.gitDirDev, target.capability?.gitDirIno);
          const commonOk = target.gitCommonDir === target.gitDir
            ? gitDirOk
            : await verifyStatIdentityFields(target.gitCommonDir, target.capability?.gitCommonDev, target.capability?.gitCommonIno);
          if (!gitDirOk || !commonOk
            || !(await verifyStatIdentity(target.cwd, authorized.identity))
            || (authorized.mainRepoRoot && authorized.mainRepoRoot !== authorized.cwd
              && !(await verifyStatIdentity(authorized.mainRepoRoot, authorized.mainIdentity)))) {
            disposeTarget(target);
            return null;
          }
        }
        let pinned = null;
        if (directory) {
          const anchoredPath = (targetPath) => {
            const inTarget = relative(target.cwd, targetPath);
            if (inTarget === '' || (inTarget !== '..' && !inTarget.startsWith(`..${sep}`) && resolve(inTarget) !== inTarget)) {
              return inTarget === '' ? cwd : `${cwd}/${inTarget}`;
            }
            if (mainDirectory) {
              const inMain = relative(target.mainRoot, targetPath);
              if (inMain === '' || (inMain !== '..' && !inMain.startsWith(`..${sep}`) && resolve(inMain) !== inMain)) {
                return inMain === '' ? procFdPath(mainDirectory) : `${procFdPath(mainDirectory)}/${inMain}`;
              }
            }
            return targetPath;
          };
          const openGitDirectory = async (path, expectedDev, expectedIno) => {
            const opened = await open(anchoredPath(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
            const identity = await opened.stat();
            if ((expectedDev !== undefined && identity.dev !== expectedDev)
              || (expectedIno !== undefined && identity.ino !== expectedIno)) {
              await opened.close().catch(() => {});
              return null;
            }
            return opened;
          };
          gitDirectory = await openGitDirectory(target.gitDir, target.capability?.gitDirDev, target.capability?.gitDirIno);
          if (!gitDirectory) return null;
          commonDirectory = target.gitCommonDir === target.gitDir
            ? gitDirectory
            : await openGitDirectory(target.gitCommonDir, target.capability?.gitCommonDev, target.capability?.gitCommonIno);
          if (!commonDirectory) return null;
          pinned = {
            GIT_DIR: procFdPath(gitDirectory),
            GIT_COMMON_DIR: procFdPath(commonDirectory),
            GIT_WORK_TREE: procFdPath(directory),
          };
        }
        return await withGitAbortSignal(lifecycle.signal, () => withPinnedGitEnvironment(pinned, async () => {
      const [probe, metadata, defaultBranch] = await Promise.all([
        statusProbe(cwd),
        readMetadata(cwd).catch(() => null),
        repositoryFact(target.mainRoot, 'defaultBranch', REPO_FACT_TTL_MS, () => resolveDefaultBranch(cwd)),
      ]);
      // One process when the merged probe answers. When it does not (locked
      // index, unreadable worktree) the narrow probes run exactly as before, so
      // a broken HEAD is still never misreported as unborn.
      const [branchInfo, status] = probe
        ? [headFromProbe(probe), statusFromProbe(probe)]
        : await Promise.all([currentBranchInfo(cwd), porcelainStatus(cwd)]);
      if (!isLive(target, token)) return target.snapshot;
      const branch = branchInfo.branch;
      const metadataBaseName = safeBaseName(metadata?.baseRefName);
      const baseName = metadataBaseName || safeBaseName(defaultBranch);
      const bestBase = baseName
        ? await repositoryFact(target.mainRoot, `baseRef:${baseName}`, BASE_REF_TTL_MS, () => resolveBestComparisonBaseRef(cwd, baseName))
        : null;
      if (!isLive(target, token)) return target.snapshot;
      // A display branch can move or disappear. Only a typed immutable commit
      // may be the metadata fallback; raw metadata never becomes a Git option.
      const immutableBase = FULL_OID.test(metadata?.baseRef || '') ? metadata.baseRef : null;
      const comparisonBase = bestBase || immutableBase;
      const [abResult, upstream, remote] = await Promise.all([
        comparisonBase
          ? aheadBehind(cwd, comparisonBase)
          : Promise.resolve(branchInfo.ok
            ? { ok: true, ahead: 0, behind: 0 }
            : { ok: false, ahead: null, behind: null, error: branchInfo.error || 'cannot resolve HEAD' }),
        branch ? upstreamInfo(cwd, branch) : Promise.resolve({ upstreamRef: null, aheadOfOrigin: 0, behindOfOrigin: 0 }),
        repositoryFact(target.mainRoot, 'originUrl', REPO_FACT_TTL_MS, () => originUrl(cwd)),
      ]);
      if (!isLive(target, token)) return target.snapshot;
      const originDeltaResult = branch && !upstream.upstreamRef ? await originBranchDelta(cwd, branch) : null;
      if (!isLive(target, token)) return target.snapshot;
      const degraded = [];
      if (!branchInfo.ok) degraded.push({ stage: 'head', message: branchInfo.error || 'cannot resolve HEAD' });
      if (!status.ok) degraded.push({ stage: 'status', message: status.error || 'git status failed' });
      if (!abResult.ok) degraded.push({ stage: 'ahead-behind', message: abResult.error || 'git rev-list failed' });
      if (originDeltaResult && !originDeltaResult.ok) degraded.push({ stage: 'origin-delta', message: originDeltaResult.error || 'git rev-list failed' });
      const originDelta = originDeltaResult?.ok && originDeltaResult.exists
        ? { ahead: originDeltaResult.ahead, behind: originDeltaResult.behind }
        : null;
      // comparison ref for the badge DiffStat (paseo): base branch when current≠base,
      // else origin/<current> when it exists
      let comparisonRef = comparisonBase;
      if (branch && baseName && branch === baseName && originDelta) comparisonRef = `refs/remotes/origin/${branch}`;
      const statResult = await diffStat(cwd, comparisonRef);
      if (!isLive(target, token)) return target.snapshot;
      if (!statResult.ok) degraded.push({ stage: 'diff-stat', message: statResult.error || 'git diff failed' });
      const ab = abResult.ok
        ? { ahead: abResult.ahead, behind: abResult.behind }
        : null;
      const stat = statResult.ok
        ? { additions: statResult.additions, deletions: statResult.deletions, files: statResult.files }
        : target.snapshot?.diffStat ?? null;
      // The target's discovery is this same repository, established by
      // `ensureTarget` and re-proved by the dev/ino checks at the top of this
      // compute — re-running `detectRepo` here would be three more processes
      // for a fact already in hand. The live proofs inside
      // `validateManagedWorktree` (worktree-list row, metadata, realpaths) stay.
      const managed = metadata
        ? (await validateManagedWorktree(cwd, {
            detected: {
              isGit: true,
              repoRoot: target.repoRoot,
              gitDir: target.gitDir,
              gitCommonDir: target.gitCommonDir,
              isLinkedWorktree: target.isLinkedWorktree,
              mainRepoRoot: target.mainRoot,
            },
          })).ok
        : false;
      if (!isLive(target, token)) return target.snapshot;
      // `remote` was already read above; the forge identity is that same remote
      // parsed, so asking for it again was a second discovery of one fact.
      const originIdentity = parseGithubRemote(remote);
      if (!isLive(target, token)) return target.snapshot;
      const pullProvenanceValid = validPullProvenance(metadata);
      const pullProvenanceMalformed = metadata?.intent === 'pr-checkout' && !pullProvenanceValid;
      const pullIdentity = pullProvenanceValid
        ? { host: metadata.pullHost, owner: metadata.pullOwner, repo: metadata.pullRepo }
        : null;
      const upstreamIdentity = pullIdentity ? parseGithubRemote(await remoteUrl(cwd, 'upstream').catch(() => null)) : null;
      const pullKey = forgeRepositoryKey(pullIdentity);
      const pullIdentityTrusted = Boolean(pullIdentity && pullKey && managed && [originIdentity, upstreamIdentity]
        .some((identity) => forgeRepositoryKey(identity) === pullKey));
      // Older PR metadata has no repository identity. A number plus commit SHA
      // cannot bind a repository (forks share objects), so remote status and
      // destructive actions stay disabled until the worktree is recreated.
      const legacyPullProbe = false;
      const unsafePullIdentity = pullProvenanceMalformed || (pullProvenanceValid && !pullIdentityTrusted);
      const github = pullIdentityTrusted ? pullIdentity : originIdentity;
      let forgeAuth = 'no_remote';
      if (github) {
        if (!(await ghAvailable(lifecycle.signal))) forgeAuth = lifecycle.signal.aborted ? 'error' : 'cli_missing';
        else {
          if (!isLive(target, token)) return target.snapshot;
          forgeAuth = (await ghAuthenticated(github.host, lifecycle.signal)) ? 'ok' : lifecycle.signal.aborted ? 'error' : 'unauthenticated';
        }
      }
      if (!isLive(target, token)) return target.snapshot;
      const statusEntries = status.ok ? status.entries : null;
      const untrackedCount = statusEntries
        ? statusEntries.filter((entry) => entry.code === '??').length
        : target.snapshot?.untrackedCount ?? null;
      let pr = unsafePullIdentity ? null : target.snapshot?.pr ?? null;
      let fetchedPr = false;
      // first compute fetches PR inline so the badge appears without waiting for the poll grid
      if (!unsafePullIdentity && !target.snapshot && github && branch && forgeAuth === 'ok') {
        try {
          const result = await prStatusBatch([
            { key: cwd, host: github.host, owner: github.owner, repo: github.repo, pullNumber: pullIdentityTrusted ? metadata.pullNumber : undefined, headRef: pullIdentityTrusted ? metadata.pullHeadRef : branch, headSha: branchInfo.sha },
          ], { signal: lifecycle.signal });
          if (!isLive(target, token)) return target.snapshot;
          pr = result.get(cwd)?.pr ?? null;
          fetchedPr = true;
          if (pullIdentityTrusted && pr?.number !== metadata.pullNumber) pr = null;
          target.nextPrAt = Date.now() + (pr?.checks?.status === 'pending' ? PR_PENDING_MS : PR_IDLE_MS);
        } catch {
          /* poll loop retries */
        }
      }
      if (!isLive(target, token)) return target.snapshot;
      if (!(await withoutPinnedGitEnvironment(() => reauthorize(target, token)))) return null;
      // A background PR poll may have committed while this slower filesystem
      // compute was in flight. Preserve it only when both operations addressed
      // the exact same repository/number-or-head/SHA selector.
      const nextPrSelector = prSelectorKey({
        github,
        prNumber: (pullIdentityTrusted || legacyPullProbe) && Number.isSafeInteger(metadata?.pullNumber) ? metadata.pullNumber : null,
        prHeadRef: pullIdentityTrusted || legacyPullProbe ? metadata?.pullHeadRef ?? null : null,
        branch,
        prLookupSha: legacyPullProbe ? metadata.prHeadSha : branchInfo.sha ?? null,
        sha: branchInfo.sha,
        prPollingDisabled: unsafePullIdentity,
      });
      if (!fetchedPr && !unsafePullIdentity && target.snapshot
        && prSelectorKey(target.snapshot) === nextPrSelector) pr = target.snapshot.pr ?? null;
      else if (!fetchedPr && prSelectorKey(target.snapshot) !== nextPrSelector) {
        pr = null;
        target.nextPrAt = 0;
      }
      const snapshot = {
        cwd: target.cwd,
        isGit: true,
        repoRoot: target.repoRoot,
        mainRepoRoot: target.mainRoot,
        isLinkedWorktree: target.isLinkedWorktree,
        managed,
        baseRefName: baseName ?? null,
        baseRef: comparisonBase,
        defaultBranch: defaultBranch ?? null,
        branch,
        detached: Boolean(branchInfo.detached),
        detachedShort: branchInfo.detachedShort ?? null,
        sha: branchInfo.sha ?? null,
        unborn: Boolean(branchInfo.unborn),
        dirty: status.ok ? status.dirty : target.snapshot?.dirty ?? null,
        changedFileCount: statusEntries ? statusEntries.length : target.snapshot?.changedFileCount ?? null,
        untrackedCount,
        aheadBehind: ab,
        upstream: upstream.upstreamRef
          ? { ref: upstream.upstreamRef, ahead: upstream.aheadOfOrigin, behind: upstream.behindOfOrigin }
          : null,
        originDelta,
        diffStat: stat,
        remote,
        github,
        forgeAuth,
        prHeadRef: pullIdentityTrusted || legacyPullProbe ? metadata?.pullHeadRef ?? null : null,
        prNumber: (pullIdentityTrusted || legacyPullProbe) && Number.isSafeInteger(metadata?.pullNumber) ? metadata.pullNumber : null,
        prLookupSha: legacyPullProbe ? metadata.prHeadSha : branchInfo.sha ?? null,
        prRequireShaMatch: legacyPullProbe,
        prPollingDisabled: unsafePullIdentity,
        pr,
        gitKnown: {
          head: branchInfo.ok,
          status: status.ok,
          aheadBehind: abResult.ok,
          originDelta: branchInfo.ok && (originDeltaResult === null || originDeltaResult.ok),
          diffStat: statResult.ok,
        },
        degraded,
        at: Date.now(),
      };
      const fingerprint = JSON.stringify({ ...snapshot, at: undefined });
      target.lastComputeAt = Date.now();
      const changed = fingerprint !== target.fingerprint;
      target.snapshot = snapshot;
      target.fingerprint = fingerprint;
      target.github = github;
      if (changed) emit(snapshot);
      return snapshot;
    }));
      } finally {
        if (commonDirectory && commonDirectory !== gitDirectory) await commonDirectory.close().catch(() => {});
        await gitDirectory?.close().catch(() => {});
        await mainDirectory?.close().catch(() => {});
        await directory?.close().catch(() => {});
      }
    }).finally(() => {
      target.computing = null;
      if (target.recomputeAfterCurrent && !target.disposed && !disposed) {
        target.recomputeAfterCurrent = false;
        scheduleCompute(target, 0, true);
      }
    });
    target.computing = track(promise);
    return target.computing;
  }

  /* ---------------- background fetch (180 s per repo) ---------------- */

  function scheduleFetch(mainRoot, delayMs) {
    const repo = repos.get(mainRoot);
    if (!repo || disposed) return;
    repo.nextFetchAt = Date.now() + delayMs;
  }

  async function runDueFetches() {
    const now = Date.now();
    // A fetch is network-bound: it holds its lane slot for as long as the remote
    // takes to answer. Starting every due repository at once at boot (the state
    // this replaced) put up to eight of them in front of the page load, so they
    // start at most a couple per tick and the rest stay due for the next one.
    let started = 0;
    for (const [mainRoot, repo] of [...repos.entries()]) {
      if (started >= MAX_FETCHES_PER_TICK) break;
      if (repo.fetching || now < repo.nextFetchAt || repo.cwds.size === 0) continue;
      started += 1;
      const token = epoch;
      repo.nextFetchAt = now + FETCH_INTERVAL_MS;
      if (disposed || token !== epoch) continue;
      repo.fetching = true;
      const fetchTask = mutations.run(`git:${mainRoot}`, async () => {
        if (disposed || token !== epoch || repos.get(mainRoot) !== repo) return null;
        let authorizedCapability = null;
        let authorizedTarget = null;
        if (typeof authorizeTarget === 'function') {
          for (const cwd of repo.cwds) {
            const target = targets.get(cwd);
            if (!target) continue;
            const current = await authorizeTarget(cwd);
            if (disposed || token !== epoch || repos.get(mainRoot) !== repo) return null;
            if (current?.ok
              && current.gitBoundary === 'root'
              && current.cwd === cwd
              && current.mainRepoRoot === mainRoot
              && current.identity?.dev === target.capability?.dev
              && current.identity?.ino === target.capability?.ino
              && current.mainIdentity?.dev === target.capability?.mainDev
              && current.mainIdentity?.ino === target.capability?.mainIno
              && current.gitCommonDir === target.capability?.gitCommonDir
              && current.gitCommonIdentity?.dev === target.capability?.gitCommonDev
              && current.gitCommonIdentity?.ino === target.capability?.gitCommonIno) {
              authorizedCapability = current;
              authorizedTarget = target;
              break;
            }
            disposeTarget(target);
          }
          if (!authorizedCapability) return null;
        }
        let directory = null;
        let mainDirectory = null;
        let commonDirectory = null;
        try {
          let stableCwd = mainRoot;
          if (authorizedCapability && isDirfdPinSupported()) {
            directory = await open(authorizedCapability.cwd, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
            const identity = await directory.stat();
            if (identity.dev !== authorizedCapability.identity.dev || identity.ino !== authorizedCapability.identity.ino) return null;
            if (authorizedCapability.mainRepoRoot !== authorizedCapability.cwd) {
              mainDirectory = await open(authorizedCapability.mainRepoRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
              const mainIdentity = await mainDirectory.stat();
              if (mainIdentity.dev !== authorizedCapability.mainIdentity?.dev
                || mainIdentity.ino !== authorizedCapability.mainIdentity?.ino) return null;
            }
            stableCwd = procFdPath(mainDirectory || directory);
            const commonPath = authorizedCapability.gitCommonDir || authorizedTarget?.gitCommonDir;
            const inMain = relative(authorizedCapability.mainRepoRoot, commonPath);
            const familyDirectory = mainDirectory || directory;
            const anchoredCommon = familyDirectory && (inMain === '' || (inMain !== '..' && !inMain.startsWith(`..${sep}`) && resolve(inMain) !== inMain))
              ? inMain === '' ? procFdPath(familyDirectory) : `${procFdPath(familyDirectory)}/${inMain}`
              : commonPath;
            commonDirectory = await open(anchoredCommon, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
            const commonIdentity = await commonDirectory.stat();
            if ((authorizedCapability.gitCommonIdentity?.dev !== undefined && commonIdentity.dev !== authorizedCapability.gitCommonIdentity.dev)
              || (authorizedCapability.gitCommonIdentity?.ino !== undefined && commonIdentity.ino !== authorizedCapability.gitCommonIdentity.ino)) return null;
          } else if (authorizedCapability) {
            // Path mode: stat identity against the capability captured when
            // the fetch was scheduled (ADR 0013).
            if (!(await verifyStatIdentity(authorizedCapability.cwd, authorizedCapability.identity))) return null;
            if (authorizedCapability.mainRepoRoot !== authorizedCapability.cwd
              && !(await verifyStatIdentity(authorizedCapability.mainRepoRoot, authorizedCapability.mainIdentity))) return null;
            const commonPath = authorizedCapability.gitCommonDir || authorizedTarget?.gitCommonDir;
            if (!(await verifyStatIdentityFields(commonPath, authorizedCapability.gitCommonIdentity?.dev, authorizedCapability.gitCommonIdentity?.ino))) return null;
          }
          const fetchOperation = async () => {
            repo.hasOrigin = Boolean(await originUrl(stableCwd, { signal: lifecycle.signal, background: true }));
            if (!repo.hasOrigin || disposed || token !== epoch) return null;
            // Short enough to bound a lane slot, long enough for a slow remote.
            // A failure keeps `nextFetchAt` where the scheduler put it, so an
            // offline host fails fast instead of retrying in a tight loop.
            return runGit(['fetch', 'origin', '--prune'], {
              cwd: stableCwd,
              timeout: FETCH_TIMEOUT_MS,
              signal: lifecycle.signal,
              background: true,
            });
          };
          return await (commonDirectory
            ? withPinnedGitEnvironment({
                GIT_DIR: procFdPath(commonDirectory),
                GIT_COMMON_DIR: procFdPath(commonDirectory),
                GIT_WORK_TREE: procFdPath(mainDirectory || directory),
              }, fetchOperation)
            : fetchOperation());
        } finally {
          await commonDirectory?.close().catch(() => {});
          await mainDirectory?.close().catch(() => {});
          await directory?.close().catch(() => {});
        }
      }, { signal: lifecycle.signal })
        .then((fetchResult) => {
          if (!fetchResult?.ok || disposed || token !== epoch || repos.get(mainRoot) !== repo) return;
          // The fetch moved remote-tracking refs; every ref-derived fact cached
          // for this repository is now stale by definition.
          dropFacts(mainRoot);
          for (const cwd of repo.cwds) {
            const target = targets.get(cwd);
            if (target) scheduleCompute(target, WATCH_DEBOUNCE_MS, true);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (repos.get(mainRoot) === repo) repo.fetching = false;
        });
      track(fetchTask);
    }
  }

  /* ---------------- adaptive PR/checks poll ---------------- */

  let prPolling = false;
  async function runDuePrPolls() {
    if (prPolling || disposed) return;
    prPolling = true;
    try {
    const token = epoch;
    const now = Date.now();
    const due = [];
    for (const target of targets.values()) {
      const s = target.snapshot;
      if (!s || !s.github || !s.branch || s.forgeAuth !== 'ok' || s.prPollingDisabled) continue;
      if (now < target.nextPrAt) continue;
      due.push(target);
    }
    if (due.length === 0) return;
    const authorizedDue = [];
    for (const target of due) {
      if (typeof authorizeTarget !== 'function') {
        authorizedDue.push(target);
        continue;
      }
      if (await reauthorize(target, token)) authorizedDue.push(target);
    }
    if (authorizedDue.length === 0) return;
    const pollingTargets = authorizedDue.slice(0, 20);
    const selectors = new Map(pollingTargets.map((t) => [t.cwd, prSelectorKey(t.snapshot)]));
    const batch = pollingTargets.map((t) => ({
      key: t.cwd,
      host: t.snapshot.github.host,
      owner: t.snapshot.github.owner,
      repo: t.snapshot.github.repo,
      pullNumber: t.snapshot.prNumber,
      headRef: t.snapshot.prHeadRef || t.snapshot.branch,
      headSha: t.snapshot.prLookupSha || t.snapshot.sha,
    }));
    let results;
    try {
      results = await prStatusBatch(batch, { signal: lifecycle.signal });
    } catch {
      if (disposed || token !== epoch) return;
      for (const t of pollingTargets) {
        if (!(await reauthorize(t, token))) continue;
        if (selectors.get(t.cwd) !== prSelectorKey(t.snapshot)) continue;
        t.prBackoffMs = Math.min(Math.max(t.prBackoffMs * 2, PR_PENDING_MS), PR_BACKOFF_CAP_MS);
        t.nextPrAt = Date.now() + t.prBackoffMs;
      }
      return;
    }
    if (disposed || token !== epoch) return;
    for (const t of pollingTargets) {
      if (t.disposed || targets.get(t.cwd) !== t) continue;
      if (!(await reauthorize(t, token))) continue;
      if (selectors.get(t.cwd) !== prSelectorKey(t.snapshot)) continue;
      const value = results.get(t.cwd);
      if (!value || !t.snapshot) {
        t.nextPrAt = Date.now() + PR_IDLE_MS;
        continue;
      }
      if (value.forgeAuth === 'error') {
        t.prBackoffMs = Math.min(Math.max(t.prBackoffMs * 2, PR_PENDING_MS), PR_BACKOFF_CAP_MS);
        t.nextPrAt = Date.now() + t.prBackoffMs;
        continue;
      }
      if (value.forgeAuth !== 'ok') {
        const changed = t.snapshot.forgeAuth !== value.forgeAuth || t.snapshot.pr !== null;
        t.snapshot = { ...t.snapshot, forgeAuth: value.forgeAuth, pr: null, at: Date.now() };
        t.fingerprint = JSON.stringify({ ...t.snapshot, at: undefined });
        t.prBackoffMs = 0;
        t.nextPrAt = Date.now() + PR_IDLE_MS;
        if (changed) emit(t.snapshot);
        continue;
      }
      t.prBackoffMs = 0;
      let pr = value.pr ?? null;
      if (Number.isSafeInteger(t.snapshot.prNumber)
        && (pr?.number !== t.snapshot.prNumber || (t.snapshot.prRequireShaMatch && pr?.headShaMatches !== true))) pr = null;
      const prev = JSON.stringify(t.snapshot.pr ?? null);
      t.snapshot = { ...t.snapshot, pr, at: Date.now() };
      t.fingerprint = JSON.stringify({ ...t.snapshot, at: undefined });
      t.nextPrAt = Date.now() + (pr?.checks?.status === 'pending' ? PR_PENDING_MS : PR_IDLE_MS);
      if (prev !== JSON.stringify(pr ?? null)) emit(t.snapshot);
    }
    } finally {
      prPolling = false;
    }
  }

  /* ---------------- prune + watcher blind-spot sweep ---------------- */

  function pruneStale() {
    const cutoff = Date.now() - TARGET_TTL_MS;
    for (const target of [...targets.values()]) {
      if (target.lastAccess < cutoff) disposeTarget(target);
    }
    const negativeCutoff = Date.now() - NEGATIVE_TTL_MS;
    for (const [cwd, checkedAt] of negatives) if (checkedAt < negativeCutoff) negatives.delete(cwd);
  }

  // A recursive watch that silently stops delivering is not observable, so a
  // small round-robin sweep re-computes a few targets per minute regardless. It
  // is capped on purpose: the point is coverage, not a full refresh wave.
  let sweepCursor = 0;
  function sweepStaleTargets() {
    const all = [...targets.values()];
    if (all.length === 0) return 0;
    const count = Math.min(BACKGROUND_SWEEP_MAX_TARGETS, all.length);
    for (let i = 0; i < count; i += 1) {
      const target = all[(sweepCursor + i) % all.length];
      if (target && !target.disposed) scheduleCompute(target, 0, true);
    }
    sweepCursor = (sweepCursor + count) % all.length;
    return count;
  }

  const tickTimer = setInterval(() => {
    if (disposed) return;
    track(runDueFetches().catch(() => {}));
    track(runDuePrPolls().catch(() => {}));
  }, TICK_MS);
  const sweepTimer = setInterval(() => {
    if (!disposed) sweepStaleTargets();
  }, BACKGROUND_SWEEP_MS);
  const pruneTimer = setInterval(() => {
    if (!disposed) pruneStale();
  }, 60000);
  // These timers are housekeeping, never the reason this process should live, so
  // they must not pin the event loop. That is not hypothetical: a suite that
  // failed before its `finally` held these intervals open and left a CI job
  // waiting out its whole 45-minute timeout after every case had already
  // reported. The host itself is kept alive by the web server. `unref` is
  // optional because a test double for `setInterval` need not implement it.
  tickTimer.unref?.();
  sweepTimer.unref?.();
  pruneTimer.unref?.();

  /* ---------------- public face ---------------- */

  let lastGlobalRefresh = 0;
  return {
    /**
     * Fresh snapshot for one cwd (computes on demand, 3 s cache; `fresh:true`
     * skips the cache).
     *
     * `background` defaults to false because the callers of this method are
     * HTTP handlers that await the answer: `/actions` and `/snapshot` must start
     * before the recompute wave a page load just kicked, not behind it. The one
     * caller that nobody is waiting on — the `pending` wave — passes `true`,
     * which also covers the authorization that creates the target (ADR 0018).
     */
    async snapshotFor(cwd, opts = {}) {
      const background = opts.background === true;
      const target = await track(withGitLaneOf(background, () => ensureTarget(cwd)));
      if (!target) {
        const neg = { cwd, isGit: false, at: Date.now() };
        return neg;
      }
      target.lastAccess = Date.now();
      if (opts.fresh && target.computing) {
        try { await target.computing; } catch { /* stale attempt; recompute below */ }
      }
      if (!opts.fresh && target.snapshot && Date.now() - target.lastComputeAt < SNAPSHOT_FRESH_MS) {
        return target.snapshot;
      }
      return (await computeTarget(target, Boolean(opts.fresh), false, background)) ?? target.snapshot ?? { cwd, isGit: false };
    },
    /**
     * Batch snapshots that wait (the explicit `{ fresh: true }` refresh).
     *
     * Foreground by default, like every other awaited caller. The client only
     * uses this path for one cwd at a time (`refresh(cwd)` in the feed), so the
     * fan-out here is one compute; a caller that ever batches a forced refresh
     * would be front-loading N foreground computes and should reconsider.
     */
    async snapshots(cwds) {
      const unique = [...new Set((cwds ?? []).filter((c) => typeof c === 'string' && c !== ''))].slice(0, 200);
      const results = await Promise.all(unique.map((cwd) => this.snapshotFor(cwd)));
      const byCwd = {};
      results.forEach((snapshot, i) => {
        byCwd[unique[i]] = snapshot;
      });
      return byCwd;
    },
    /**
     * Batch snapshots that never wait for a compute (ADR 0018).
     *
     * Whatever is already known is answered as-is — a stale snapshot is the
     * previous truth about the same repository, and the client keeps rendering
     * it. A cwd nobody has computed yet is named in `pending` and scheduled,
     * and the SSE stream delivers it when it lands. That is what turns a cold
     * 20-workspace page load from one long request into one short one.
     */
    async snapshotsFast(cwds) {
      const unique = [...new Set((cwds ?? []).filter((c) => typeof c === 'string' && c !== ''))].slice(0, 200);
      const byCwd = {};
      const pending = [];
      for (const cwd of unique) {
        const target = targets.get(cwd);
        if (target?.snapshot) {
          target.lastAccess = Date.now();
          byCwd[cwd] = target.snapshot;
          continue;
        }
        const checkedAt = negatives.get(cwd);
        if (checkedAt !== undefined && Date.now() - checkedAt < NEGATIVE_TTL_MS) {
          byCwd[cwd] = { cwd, isGit: false, at: checkedAt };
          continue;
        }
        pending.push(cwd);
      }
      // Kick, never await. Duplicate kicks are harmless: `snapshotFor` joins the
      // in-flight compute of the same target. Background-class: a page load's
      // fan-out must never claim a lane slot an interactive read is waiting for,
      // and the 10 s promotion still guarantees this wave makes progress.
      for (const cwd of pending) track(this.snapshotFor(cwd, { background: true }).catch(() => {}));
      return { byCwd, pending };
    },
    /** Force an immediate recompute (after mutations / session events); resolves with the fresh snapshot. */
    async invalidate(cwd) {
      negatives.delete(cwd);
      const target = await track(ensureTarget(cwd));
      if (!target) return null;
      // A mutation the user just performed changed refs and possibly the remote
      // URL: repository facts computed before it are no longer worth a TTL.
      dropFacts(target.mainRoot);
      target.lastAccess = Date.now();
      if (target.computing) {
        try { await target.computing; } catch { /* join then supersede */ }
      }
      return computeTarget(target, true, false, false);
    },
    /** Throttled refresh of every active target (fallback when no cwd is known). */
    refreshActive() {
      const now = Date.now();
      if (now - lastGlobalRefresh < 5000) return;
      lastGlobalRefresh = now;
      for (const target of targets.values()) scheduleCompute(target, WATCH_DEBOUNCE_MS, true);
    },
    /**
     * Recompute one repository family: the target at `cwd` and every tracked
     * checkout sharing its main root.
     *
     * A tool result or a status flip names one Session, hence one workspace. The
     * old wiring answered every event by recomputing all twenty targets, which
     * is a ~25 s lane load per wave on Windows — longer than the 5 s floor, so
     * the lane never drained while an agent worked. Returns how many targets it
     * scheduled, and 0 when the cwd is not tracked (nothing to refresh; the
     * minute sweep covers it).
     */
    async invalidateFamily(cwd) {
      const exact = targets.get(cwd);
      let mainRoot = exact && !exact.disposed ? exact.mainRoot : null;
      if (!mainRoot) {
        // A Session that moved into a worktree reports the original project as its
        // cwd; resolving the family is what connects the two.
        const detected = await detectRepoCached(cwd).catch(() => ({ isGit: false }));
        mainRoot = detected.isGit ? detected.mainRepoRoot : null;
      }
      if (!mainRoot || disposed) return 0;
      let scheduled = 0;
      for (const candidate of targets.values()) {
        if (candidate.disposed || candidate.mainRoot !== mainRoot) continue;
        scheduleCompute(candidate, 0, true);
        scheduled += 1;
      }
      return scheduled;
    },
    /** Run one sweep now (bounded, round-robin). Diagnostic surface for tests. */
    sweepNow() {
      return sweepStaleTargets();
    },
    /** Read the cached snapshot without computing (may be null). */
    peek(cwd) {
      return targets.get(cwd)?.snapshot ?? null;
    },
    /** Counters for the plugin's read path. Diagnostic, not a contract. */
    stats() {
      return {
        targets: targets.size,
        facts: facts.size,
        negatives: negatives.size,
        fetching: [...repos.values()].filter((repo) => repo.fetching).length,
      };
    },
    isKnownGit(cwd) {
      return targets.has(cwd);
    },
    async dispose() {
      if (disposed) {
        await Promise.allSettled([...inflight]);
        return;
      }
      disposed = true;
      epoch += 1;
      lifecycle.abort();
      clearInterval(tickTimer);
      clearInterval(sweepTimer);
      clearInterval(pruneTimer);
      for (const target of [...targets.values()]) disposeTarget(target);
      targets.clear();
      repos.clear();
      await Promise.allSettled([...inflight]);
    },
  };
}

export { mainRepoRootOf };
