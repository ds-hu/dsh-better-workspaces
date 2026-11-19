/**
 * The pure/helper surface every bundle re-exports for the offline suites.
 *
 * `__bwTest` is a test hook, not an API: the browser suite merges the four
 * bundles' objects in a fixed order, so the core helpers below are spread into
 * every bundle's object (a duplicate later in the merge is the same pure copy).
 */
import {
  createPollScheduler,
  createDenyList,
  learnGitAlias,
  dropGitAlias,
  forgetGitAlias,
  staleGitAliases,
  planSnapshotBatch,
  SNAPSHOT_BATCH_MAX,
  SNAPSHOT_CACHE_KEY,
  SNAPSHOT_CACHE_MAX,
  SNAPSHOT_CACHE_MAX_AGE_MS,
  SNAPSHOT_CACHE_MAX_BYTES,
  SNAPSHOT_CACHE_WRITE_DELAY_MS,
  readSnapshotCache,
  writeSnapshotCache,
  snapshotCacheSignature,
  DEFERRED_RECOVERY_BUSY_MS,
  DEFERRED_RECOVERY_IDLE_MS,
} from './feed.js';
import { createRequestOwner } from './api.js';
import { failureMessage, mnemonicSlug, basenameOf } from './util.js';
import { setTestRuntime } from './runtime.js';
import { effectiveSessionCwd, currentSessionId } from './session.js';
import {
  collectTouched,
  normalizeTouchedPaths,
  readSessionDraft,
  inputTier,
  sessionsHaveEmptyDrafts,
  transferSessionDraft,
  getLastDraftTransferReason,
} from './draft.js';
import {
  acquireWorkspaceMutation,
  deferredRecoveryTargets,
  deferredRecoveryDelay,
} from './workspace.js';
import { nearestLayoutAncestor } from './dom.js';
import { installDebugHook, projectSessionSnapshot, projectWorkspaceSnapshot } from './debug.js';
import { createPrefs } from './prefs.js';

/** Build the core part of one bundle's `__bwTest`. */
export function coreTestExports() {
  return {
    setTestRuntime,
    createPollScheduler,
    createDenyList,
    learnGitAlias,
    dropGitAlias,
    forgetGitAlias,
    staleGitAliases,
    planSnapshotBatch,
    SNAPSHOT_BATCH_MAX,
    SNAPSHOT_CACHE_KEY,
    SNAPSHOT_CACHE_MAX,
    SNAPSHOT_CACHE_MAX_AGE_MS,
    SNAPSHOT_CACHE_MAX_BYTES,
    SNAPSHOT_CACHE_WRITE_DELAY_MS,
    readSnapshotCache,
    writeSnapshotCache,
    snapshotCacheSignature,
    createRequestOwner,
    failureMessage,
    mnemonicSlug,
    basenameOf,
    effectiveSessionCwd,
    currentSessionId,
    collectTouched,
    normalizeTouchedPaths,
    readSessionDraft,
    inputTier,
    sessionsHaveEmptyDrafts,
    transferSessionDraft,
    lastDraftTransferReason: getLastDraftTransferReason,
    acquireWorkspaceMutation,
    deferredRecoveryTargets,
    deferredRecoveryDelay,
    DEFERRED_RECOVERY_BUSY_MS,
    DEFERRED_RECOVERY_IDLE_MS,
    nearestLayoutAncestor,
    installDebugHook,
    projectSessionSnapshot,
    projectWorkspaceSnapshot,
    createPrefs,
  };
}
